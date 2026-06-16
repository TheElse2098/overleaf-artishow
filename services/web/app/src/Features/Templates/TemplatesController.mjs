import path from 'node:path'
import SessionManager from '../Authentication/SessionManager.mjs'
import TemplatesManager from './TemplatesManager.mjs'
import ProjectHelper from '../Project/ProjectHelper.mjs'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import { Project } from '../../models/Project.mjs'
import { User } from '../../models/User.mjs'
import { ObjectId } from 'mongodb'

const TemplatesController = {
  async getV1Template(req, res) {
    const templateVersionId = req.params.Template_version_id
    const templateId = req.query.id
    if (!/^[0-9]+$/.test(templateVersionId) || !/^[0-9]+$/.test(templateId)) {
      logger.err(
        { templateVersionId, templateId },
        'invalid template id or version'
      )
      return res.sendStatus(400)
    }
    const data = {
      templateVersionId,
      templateId,
      name: req.query.templateName,
      compiler: ProjectHelper.compilerFromV1Engine(req.query.latexEngine),
      imageName: req.query.texImage,
      mainFile: req.query.mainFile,
      brandVariationId: req.query.brandVariationId,
    }
    res.render(
      path.resolve(
        import.meta.dirname,
        '../../../views/project/editor/new_from_template'
      ),
      data
    )
  },

  async getLocalTemplates(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    // "General" templates are visible to everyone; "Personnel" templates are
    // visible only to their owner. Trashed projects are excluded (permanently
    // deleted projects drop out of the collection automatically).
    const projects = await Project.find(
      {
        isTemplate: true,
        $and: [
          { $or: [{ trashed: { $exists: false } }, { trashed: { $size: 0 } }] },
          {
            $or: [
              { templateCategory: { $ne: 'Personnel' } },
              { templateCategory: 'Personnel', owner_ref: userId },
            ],
          },
        ],
      },
      { name: 1, templateDescription: 1, templateCategory: 1 }
    ).lean()
    const templates = projects.map(p => ({
      id: p._id.toString(),
      name: p.name,
      description: p.templateDescription || '',
      category: p.templateCategory === 'Personnel' ? 'Personnel' : 'General',
    }))
    res.json({ templates })
  },

  async removeTemplate(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId } = req.params
    if (!ObjectId.isValid(projectId)) {
      return res.sendStatus(400)
    }
    const user = await User.findOne({ _id: userId }, { isAdmin: 1 }).lean()
    const project = await Project.findOne(
      { _id: projectId },
      { owner_ref: 1, templateCategory: 1 }
    ).lean()
    if (!project) {
      return res.sendStatus(403)
    }
    const isOwner = project.owner_ref?.toString() === userId.toString()
    const isGeneral = project.templateCategory === 'General'
    // You can remove your own template; an admin can additionally remove any
    // "General" (shared) template — but never someone else's Personnel one.
    if (!isOwner && !(user?.isAdmin && isGeneral)) {
      return res.sendStatus(403)
    }
    await Project.updateOne(
      { _id: projectId },
      { isTemplate: false, templateDescription: '', templateCategory: '' }
    )
    res.json({ ok: true })
  },

  async setTemplateStatus(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId } = req.params
    if (!ObjectId.isValid(projectId)) {
      return res.sendStatus(400)
    }
    const user = await User.findOne({ _id: userId }, { isAdmin: 1 }).lean()
    const { isTemplate, templateDescription, isGeneral } = req.body

    // Templates can only be (un)marked on a project you own — admins included.
    // This prevents anyone (even an admin) from publishing another user's
    // private project as a template and exposing its content.
    const project = await Project.findOne(
      { _id: projectId },
      { owner_ref: 1 }
    ).lean()
    if (!project || project.owner_ref?.toString() !== userId.toString()) {
      return res.sendStatus(403)
    }

    const wantsTemplate = Boolean(isTemplate)
    // Only admins can publish a shared "General" template; anything else is a
    // "Personnel" template, visible only to its owner.
    const category = user?.isAdmin && isGeneral ? 'General' : 'Personnel'

    await Project.updateOne(
      { _id: projectId },
      {
        isTemplate: wantsTemplate,
        templateDescription: wantsTemplate ? templateDescription || '' : '',
        templateCategory: wantsTemplate ? category : '',
      }
    )
    res.json({ ok: true })
  },

  async createProjectFromV1Template(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const project = await TemplatesManager.promises.createProjectFromV1Template(
      req.body.brandVariationId,
      req.body.compiler,
      req.body.mainFile,
      req.body.templateId,
      req.body.templateName,
      req.body.templateVersionId,
      userId,
      req.body.imageName
    )
    delete req.session.templateData
    if (!project) {
      throw new Error('failed to create project from template')
    }
    return res.redirect(`/project/${project._id}`)
  },
}

export default {
  getV1Template: expressify(TemplatesController.getV1Template),
  createProjectFromV1Template: expressify(
    TemplatesController.createProjectFromV1Template
  ),
  getLocalTemplates: expressify(TemplatesController.getLocalTemplates),
  setTemplateStatus: expressify(TemplatesController.setTemplateStatus),
  removeTemplate: expressify(TemplatesController.removeTemplate),
}
