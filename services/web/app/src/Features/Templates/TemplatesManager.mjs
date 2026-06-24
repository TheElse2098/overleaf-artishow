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

  // The templates a user is allowed to see: every "General" template plus their
  // own. Returns plain objects ready for the API.
  async getVisibleTemplates(userId) {
    const projects = await Project.find(TemplatesPolicy.visibleFilter(userId), {
      name: 1,
      templateDescription: 1,
      templateCategory: 1,
    }).lean()
    return projects.map(p => ({
      id: p._id.toString(),
      name: p.name,
      description: p.templateDescription || '',
      category:
        p.templateCategory === TemplatesPolicy.GENERAL
          ? TemplatesPolicy.GENERAL
          : TemplatesPolicy.PERSONNEL,
    }))
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
    await Project.updateOne(
      { _id: projectId },
      {
        isTemplate: wantsTemplate,
        templateDescription: wantsTemplate ? templateDescription || '' : '',
        templateCategory: wantsTemplate ? category : '',
      }
    )
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
      { isTemplate: false, templateDescription: '', templateCategory: '' }
    )
  },
}

export default {
  promises: TemplatesManager,
  createProjectFromV1Template: util.callbackify(
    TemplatesManager.createProjectFromV1Template
  ),
  fetchFromV1: util.callbackify(TemplatesManager.fetchFromV1),
}
