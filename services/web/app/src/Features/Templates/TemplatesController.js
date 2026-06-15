const path = require('path')
const SessionManager = require('../Authentication/SessionManager')
const TemplatesManager = require('./TemplatesManager')
const ProjectHelper = require('../Project/ProjectHelper')
const logger = require('@overleaf/logger')
const { expressify } = require('@overleaf/promise-utils')
const { Project } = require('../../models/Project')
const { User } = require('../../models/User')

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
        __dirname,
        '../../../views/project/editor/new_from_template'
      ),
      data
    )
  },

  async getLocalTemplates(req, res) {
    // Exclude projects the owner has trashed. Projects that are permanently
    // deleted are removed from the collection entirely, so they drop out here
    // automatically.
    const projects = await Project.find(
      {
        isTemplate: true,
        $or: [{ trashed: { $exists: false } }, { trashed: { $size: 0 } }],
      },
      { name: 1, templateDescription: 1 }
    ).lean()
    const templates = projects.map(p => ({
      id: p._id.toString(),
      name: p.name,
      description: p.templateDescription || '',
    }))
    res.json({ templates })
  },

  async removeTemplate(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const user = await User.findOne({ _id: userId }, { isAdmin: 1 }).lean()
    if (!user?.isAdmin) {
      return res.sendStatus(403)
    }
    const { projectId } = req.params
    await Project.updateOne(
      { _id: projectId },
      { isTemplate: false, templateDescription: '' }
    )
    res.json({ ok: true })
  },

  async setTemplateStatus(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const user = await User.findOne({ _id: userId }, { isAdmin: 1 }).lean()
    if (!user?.isAdmin) {
      return res.sendStatus(403)
    }
    const { projectId } = req.params
    const { isTemplate, templateDescription } = req.body
    await Project.updateOne(
      { _id: projectId },
      {
        isTemplate: Boolean(isTemplate),
        templateDescription: templateDescription || '',
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

module.exports = {
  getV1Template: expressify(TemplatesController.getV1Template),
  createProjectFromV1Template: expressify(
    TemplatesController.createProjectFromV1Template
  ),
  getLocalTemplates: expressify(TemplatesController.getLocalTemplates),
  setTemplateStatus: expressify(TemplatesController.setTemplateStatus),
  removeTemplate: expressify(TemplatesController.removeTemplate),
}
