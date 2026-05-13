const path = require('path')
const fs = require('fs')
const SessionManager = require('../Authentication/SessionManager')
const TemplatesManager = require('./TemplatesManager')
const ProjectHelper = require('../Project/ProjectHelper')
const logger = require('@overleaf/logger')
const { expressify } = require('@overleaf/promise-utils')

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
    const metaDir = path.resolve(
      __dirname,
      '../../../templates/general_templates'
    )
    const templates = []
    if (fs.existsSync(metaDir)) {
      const entries = fs.readdirSync(metaDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const id = entry.name.slice(0, -5)
        try {
          const meta = JSON.parse(
            fs.readFileSync(path.join(metaDir, entry.name), 'utf8')
          )
          templates.push({ id, name: meta.name, description: meta.description })
        } catch (err) {
          logger.warn({ err, templateId: id }, 'failed to parse template metadata')
        }
      }
    }
    res.json({ templates })
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
}
