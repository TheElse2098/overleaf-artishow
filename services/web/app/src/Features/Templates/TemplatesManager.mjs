import ProjectDetailsHandler from '../Project/ProjectDetailsHandler.mjs'
import ProjectOptionsHandlerModule from '../Project/ProjectOptionsHandler.mjs'
import ProjectRootDocManagerModule from '../Project/ProjectRootDocManager.mjs'
import ProjectUploadManager from '../Uploads/ProjectUploadManager.mjs'
import fs from 'node:fs'
import util from 'node:util'
import logger from '@overleaf/logger'
import {
  fetchJson,
  fetchStreamWithResponse,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import settings from '@overleaf/settings'
import crypto from 'node:crypto'
import Errors from '../Errors/Errors.js'
import { pipeline } from 'node:stream/promises'
import ClsiCacheManager from '../Compile/ClsiCacheManager.mjs'
import Path from 'node:path'
import OError from '@overleaf/o-error'
import TemplatesPolicy from './TemplatesPolicy.mjs'
import NotificationsBuilder from '../Notifications/NotificationsBuilder.mjs'
import { Project } from '../../models/Project.mjs'
import { User } from '../../models/User.mjs'

const { promises: ProjectRootDocManager } = ProjectRootDocManagerModule
const { promises: ProjectOptionsHandler } = ProjectOptionsHandlerModule

const TemplatesManager = {
  async createProjectFromV1Template(
    brandVariationId,
    compiler,
    mainFile,
    templateId,
    templateName,
    templateVersionId,
    userId,
    imageName
  ) {
    compiler = ProjectOptionsHandler.normalizeCompiler(
      compiler || settings.defaultLatexCompiler
    )
    imageName = ProjectOptionsHandler.normalizeImageName(
      imageName || 'wl_texlive:2018.1'
    )

    const zipUrl = `${settings.apis.v1.url}/api/v1/overleaf/templates/${templateVersionId}`
    const zipReq = await fetchStreamWithResponse(zipUrl, {
      basicAuth: {
        user: settings.apis.v1.user,
        password: settings.apis.v1.pass,
      },
      signal: AbortSignal.timeout(settings.apis.v1.timeout),
    })

    const projectName = ProjectDetailsHandler.fixProjectName(templateName)
    const dumpPath = `${settings.path.dumpFolder}/${crypto.randomUUID()}_templates-manager`
    const writeStream = fs.createWriteStream(dumpPath)
    try {
      const attributes = {
        fromV1TemplateId: templateId,
        fromV1TemplateVersionId: templateVersionId,
        compiler,
        imageName,
      }
      if (brandVariationId) attributes.brandVariationId = brandVariationId

      await pipeline(zipReq.stream, writeStream)

      if (zipReq.response.status !== 200) {
        logger.warn(
          { uri: zipUrl, statusCode: zipReq.response.status },
          'non-success code getting zip from template API'
        )
        throw new OError('get zip failed', { status: zipReq.response.status })
      }
      const { fileEntries, docEntries, project } =
        await ProjectUploadManager.promises.createProjectFromZipArchiveWithName(
          userId,
          projectName,
          dumpPath,
          attributes
        )

      const prepareClsiCacheInBackground = ClsiCacheManager.prepareClsiCache(
        project._id,
        userId,
        { templateVersionId, imageName: imageName && Path.basename(imageName) }
      ).catch(err => {
        logger.warn(
          { err, templateVersionId, projectId: project._id },
          'failed to prepare clsi-cache from template'
        )
        return undefined
      })

      await TemplatesManager._setMainFile(project, mainFile)

      const found = await prepareClsiCacheInBackground
      if (found === false && project.rootDoc_id) {
        ClsiCacheManager.createTemplateClsiCache({
          templateVersionId,
          project,
          fileEntries,
          docEntries,
        }).catch(err => {
          logger.error(
            { err, templateVersionId },
            'failed to create template clsi-cache'
          )
        })
      }

      return project
    } finally {
      await fs.promises.unlink(dumpPath)
    }
  },

  async _setMainFile(project, mainFile) {
    if (mainFile == null) {
      return
    }
    const rootDocId = await ProjectRootDocManager.setRootDocFromName(
      project._id,
      mainFile
    )
    if (rootDocId) project.rootDoc_id = rootDocId
  },

  async fetchFromV1(templateId) {
    const url = new URL(`/api/v2/templates/${templateId}`, settings.apis.v1.url)

    try {
      return await fetchJson(url, {
        basicAuth: {
          user: settings.apis.v1.user,
          password: settings.apis.v1.pass,
        },
        signal: AbortSignal.timeout(settings.apis.v1.timeout),
      })
    } catch (err) {
      if (err instanceof RequestFailedError && err.response.status === 404) {
        throw new Errors.NotFoundError()
      } else {
        throw err
      }
    }
  },

  // The templates a user is allowed to see: every "General" template, their own,
  // plus templates shared with them. Returns plain objects ready for the API,
  // enriched with ownership/sharing info so the UI can show the right controls.
  async getVisibleTemplates(userId) {
    const projects = await Project.find(TemplatesPolicy.visibleFilter(userId), {
      name: 1,
      templateDescription: 1,
      templateCategory: 1,
      owner_ref: 1,
      templateShares: 1,
    }).lean()

    // A "received" template is a Personnel one the viewer doesn't own (so it was
    // shared with them). General templates are public, not "shared", so they
    // never carry a "Shared by" label even when the viewer isn't the owner.
    const isReceived = p =>
      p.templateCategory !== TemplatesPolicy.GENERAL &&
      p.owner_ref?.toString() !== userId.toString()

    // Resolve the owners of received templates, so the recipient card can show
    // "Shared by <name>". One grouped query, not one per template.
    const foreignOwnerIds = projects
      .filter(isReceived)
      .map(p => p.owner_ref)
      .filter(Boolean)
    const ownersById = new Map()
    if (foreignOwnerIds.length > 0) {
      const owners = await User.find(
        { _id: { $in: foreignOwnerIds } },
        { first_name: 1, last_name: 1, email: 1 }
      ).lean()
      for (const o of owners) {
        const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
        ownersById.set(o._id.toString(), name || o.email)
      }
    }

    return projects.map(p => {
      const isOwnedByViewer = p.owner_ref?.toString() === userId.toString()
      return {
        id: p._id.toString(),
        name: p.name,
        description: p.templateDescription || '',
        category:
          p.templateCategory === TemplatesPolicy.GENERAL
            ? TemplatesPolicy.GENERAL
            : TemplatesPolicy.PERSONNEL,
        isOwnedByViewer,
        // Owner sees how many people have ACCEPTED the share; recipient sees who shared it.
        sharedWithCount: isOwnedByViewer
          ? (p.templateShares || []).filter(s => s.status === 'accepted').length
          : undefined,
        sharedByName: isReceived(p)
          ? ownersById.get(p.owner_ref?.toString()) || undefined
          : undefined,
      }
    })
  },

  // (Un)mark a project as a template. Only the owner may do this — admins
  // included — so nobody can publish another user's private project.
  async setTemplateStatus({
    projectId,
    userId,
    isTemplate,
    templateDescription,
    isGeneral,
  }) {
    const user = await User.findOne({ _id: userId }, { isAdmin: 1 }).lean()
    const project = await Project.findOne(
      { _id: projectId },
      { owner_ref: 1 }
    ).lean()
    if (!TemplatesPolicy.canMark(project, userId)) {
      throw new Errors.ForbiddenError('not allowed to mark project as template')
    }

    const wantsTemplate = Boolean(isTemplate)
    const category = TemplatesPolicy.categoryForMarking({
      isAdmin: user?.isAdmin,
      isGeneral,
    })
    const update = {
      isTemplate: wantsTemplate,
      templateDescription: wantsTemplate ? templateDescription || '' : '',
      templateCategory: wantsTemplate ? category : '',
    }
    // Unmarking a template must drop its share list, otherwise old shares would
    // silently come back (and stay visible) if it's ever re-marked as a template.
    if (!wantsTemplate) {
      update.templateShares = []
    }
    await Project.updateOne({ _id: projectId }, update)
  },

  // Clear a project's template status. The owner can always do so; an admin can
  // additionally remove a shared "General" template, but never someone else's
  // Personnel one.
  async removeTemplate({ projectId, userId }) {
    const user = await User.findOne({ _id: userId }, { isAdmin: 1 }).lean()
    const project = await Project.findOne(
      { _id: projectId },
      { owner_ref: 1, templateCategory: 1, isTemplate: 1 }
    ).lean()
    if (!project || !TemplatesPolicy.canRemove(project, userId, user?.isAdmin)) {
      throw new Errors.ForbiddenError('not allowed to remove template')
    }
    await Project.updateOne(
      { _id: projectId },
      {
        isTemplate: false,
        templateDescription: '',
        templateCategory: '',
        templateShares: [],
      }
    )
  },

  // List the users a template is shared with, with their status (pending/accepted).
  // Only the owner may view this.
  async getTemplateShares({ projectId, userId }) {
    const project = await Project.findOne(
      { _id: projectId },
      { owner_ref: 1, isTemplate: 1, templateShares: 1 }
    ).lean()
    if (!project || !TemplatesPolicy.canShare(project, userId)) {
      throw new Errors.ForbiddenError('not allowed to view template shares')
    }
    const shares = project.templateShares || []
    if (shares.length === 0) return []
    const statusById = new Map(
      shares.map(s => [s.userId.toString(), s.status || 'pending'])
    )
    const users = await User.find(
      { _id: { $in: shares.map(s => s.userId) } },
      { first_name: 1, last_name: 1, email: 1 }
    ).lean()
    return users.map(u => ({
      userId: u._id.toString(),
      email: u.email,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email,
      status: statusById.get(u._id.toString()) || 'pending',
    }))
  },

  // Share a template with an existing user, identified by email. Only the owner
  // may share. Throws NotFoundError if no account matches the email.
  async shareTemplate({ projectId, userId, email }) {
    const project = await Project.findOne(
      { _id: projectId },
      { name: 1, owner_ref: 1, isTemplate: 1, templateCategory: 1, templateShares: 1 }
    ).lean()
    if (!project || !TemplatesPolicy.canShare(project, userId)) {
      throw new Errors.ForbiddenError('not allowed to share template')
    }
    // A "General" template is already visible to everyone, so targeted sharing
    // is meaningless — reject it rather than store a pointless share list.
    if (TemplatesPolicy.isGeneralTemplate(project)) {
      throw new Errors.InvalidError('cannot share a general template')
    }
    const normalizedEmail = (email || '').trim().toLowerCase()
    const target = await User.findOne(
      { email: normalizedEmail },
      { _id: 1, email: 1, first_name: 1, last_name: 1 }
    ).lean()
    if (!target) {
      throw new Errors.NotFoundError('no user with that email')
    }
    // Sharing with the owner is a no-op they don't need.
    if (target._id.toString() === project.owner_ref.toString()) {
      throw new Errors.InvalidError('cannot share a template with its owner')
    }
    // Already invited or already accepted → don't duplicate.
    if (TemplatesPolicy.shareFor(project, target._id)) {
      throw new Errors.InvalidError('already shared with this user')
    }

    // Add a PENDING invitation. It becomes visible only once accepted.
    await Project.updateOne(
      { _id: projectId },
      { $push: { templateShares: { userId: target._id, status: 'pending' } } }
    )

    // Notif in-app au destinataire (best-effort : un échec ne doit pas faire
    // échouer le partage lui-même). C'est via cette notif qu'il accepte/refuse.
    try {
      const owner = await User.findOne(
        { _id: project.owner_ref },
        { first_name: 1, last_name: 1, email: 1 }
      ).lean()
      const sharerName =
        [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim() ||
        owner?.email ||
        'Un utilisateur'
      await NotificationsBuilder.promises
        .templateShared(target._id.toString(), projectId.toString())
        .create({ sharerName, templateName: project.name, templateId: projectId.toString() })
    } catch (err) {
      logger.warn({ err, projectId }, 'failed to create template-shared notification')
    }

    return {
      userId: target._id.toString(),
      email: target.email,
      name:
        [target.first_name, target.last_name].filter(Boolean).join(' ').trim() ||
        target.email,
      status: 'pending',
    }
  },

  // Accept a pending share: the template becomes visible/instantiable for the user.
  // Only the invited user may accept their own share.
  async acceptShare({ projectId, userId }) {
    const res = await Project.updateOne(
      { _id: projectId, 'templateShares.userId': userId },
      { $set: { 'templateShares.$.status': 'accepted' } }
    )
    if (!res.matchedCount) {
      throw new Errors.NotFoundError('no pending share for this user')
    }
    // Clear the invitation notification (best-effort).
    try {
      await NotificationsBuilder.promises
        .templateShared(userId.toString(), projectId.toString())
        .read()
    } catch (err) {
      logger.warn({ err, projectId }, 'failed to clear template-shared notification')
    }
  },

  // Decline a pending share (or the user removing their own access): drop the entry.
  async declineShare({ projectId, userId }) {
    await Project.updateOne(
      { _id: projectId },
      { $pull: { templateShares: { userId } } }
    )
    try {
      await NotificationsBuilder.promises
        .templateShared(userId.toString(), projectId.toString())
        .read()
    } catch (err) {
      logger.warn({ err, projectId }, 'failed to clear template-shared notification')
    }
  },

  // Revoke a user's access to a shared template. The owner may remove anyone; a
  // recipient may remove only themselves (so "deleting" a shared template from
  // their catalogue just drops their own access — the owner keeps it).
  async unshareTemplate({ projectId, userId, targetUserId }) {
    const project = await Project.findOne(
      { _id: projectId },
      { owner_ref: 1, isTemplate: 1 }
    ).lean()
    if (!project) {
      throw new Errors.ForbiddenError('not allowed to unshare template')
    }
    const isSelfRemoval = targetUserId.toString() === userId.toString()
    if (!TemplatesPolicy.canShare(project, userId) && !isSelfRemoval) {
      throw new Errors.ForbiddenError('not allowed to unshare template')
    }
    await Project.updateOne(
      { _id: projectId },
      { $pull: { templateShares: { userId: targetUserId } } }
    )

    // L'accès est retiré → marquer comme lue l'éventuelle notif de partage du
    // destinataire (best-effort).
    try {
      await NotificationsBuilder.promises
        .templateShared(targetUserId.toString(), projectId.toString())
        .read()
    } catch (err) {
      logger.warn({ err, projectId }, 'failed to clear template-shared notification')
    }
  },
}

export default {
  promises: TemplatesManager,
  createProjectFromV1Template: util.callbackify(
    TemplatesManager.createProjectFromV1Template
  ),
  fetchFromV1: util.callbackify(TemplatesManager.fetchFromV1),
}
