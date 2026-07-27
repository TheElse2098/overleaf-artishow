import path from 'node:path'
import SessionManager from '../Authentication/SessionManager.mjs'
import TemplatesManager from './TemplatesManager.mjs'
import ProjectHelper from '../Project/ProjectHelper.mjs'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import Errors from '../Errors/Errors.js'
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
    const templates = await TemplatesManager.promises.getVisibleTemplates(userId)
    res.json({ templates })
  },

  async removeTemplate(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId } = req.params
    if (!ObjectId.isValid(projectId)) {
      return res.sendStatus(400)
    }
    try {
      await TemplatesManager.promises.removeTemplate({ projectId, userId })
    } catch (err) {
      if (err instanceof Errors.ForbiddenError) {
        return res.sendStatus(403)
      }
      throw err
    }
    res.json({ ok: true })
  },

  async setTemplateStatus(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId } = req.params
    if (!ObjectId.isValid(projectId)) {
      return res.sendStatus(400)
    }
    const { isTemplate, templateDescription, isGeneral } = req.body
    try {
      await TemplatesManager.promises.setTemplateStatus({
        projectId,
        userId,
        isTemplate,
        templateDescription,
        isGeneral,
      })
    } catch (err) {
      if (err instanceof Errors.ForbiddenError) {
        return res.sendStatus(403)
      }
      throw err
    }
    res.json({ ok: true })
  },

  async getTemplateShares(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId } = req.params
    if (!ObjectId.isValid(projectId)) {
      return res.sendStatus(400)
    }
    try {
      const shares = await TemplatesManager.promises.getTemplateShares({
        projectId,
        userId,
      })
      res.json({ shares })
    } catch (err) {
      if (err instanceof Errors.ForbiddenError) {
        return res.sendStatus(403)
      }
      throw err
    }
  },

  async shareTemplate(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId } = req.params
    const { email } = req.body
    if (!ObjectId.isValid(projectId)) {
      return res.sendStatus(400)
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email_required' })
    }
    try {
      const share = await TemplatesManager.promises.shareTemplate({
        projectId,
        userId,
        email,
      })
      res.json({ share })
    } catch (err) {
      if (err instanceof Errors.ForbiddenError) {
        return res.sendStatus(403)
      }
      if (err instanceof Errors.NotFoundError) {
        return res.status(404).json({ error: 'no_user' })
      }
      if (err instanceof Errors.InvalidError) {
        return res.status(400).json({ error: 'invalid_target' })
      }
      throw err
    }
  },

  async unshareTemplate(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId, userId: targetUserId } = req.params
    if (!ObjectId.isValid(projectId) || !ObjectId.isValid(targetUserId)) {
      return res.sendStatus(400)
    }
    try {
      await TemplatesManager.promises.unshareTemplate({
        projectId,
        userId,
        targetUserId,
      })
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof Errors.ForbiddenError) {
        return res.sendStatus(403)
      }
      throw err
    }
  },

  // The invited user accepts a pending share → the template becomes visible to them.
  async acceptShare(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId } = req.params
    if (!ObjectId.isValid(projectId)) {
      return res.sendStatus(400)
    }
    try {
      await TemplatesManager.promises.acceptShare({ projectId, userId })
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof Errors.NotFoundError) {
        return res.status(404).json({ error: 'no_share' })
      }
      throw err
    }
  },

  // The invited user declines a pending share (or removes their own access).
  async declineShare(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { projectId } = req.params
    if (!ObjectId.isValid(projectId)) {
      return res.sendStatus(400)
    }
    try {
      await TemplatesManager.promises.declineShare({ projectId, userId })
      res.json({ ok: true })
    } catch (err) {
      throw err
    }
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
  getTemplateShares: expressify(TemplatesController.getTemplateShares),
  shareTemplate: expressify(TemplatesController.shareTemplate),
  unshareTemplate: expressify(TemplatesController.unshareTemplate),
  acceptShare: expressify(TemplatesController.acceptShare),
  declineShare: expressify(TemplatesController.declineShare),
}
