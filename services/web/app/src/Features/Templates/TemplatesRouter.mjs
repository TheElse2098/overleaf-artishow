import AuthenticationController from '../Authentication/AuthenticationController.mjs'
import TemplatesController from './TemplatesController.mjs'
import TemplatesMiddleware from './TemplatesMiddleware.mjs'
import { RateLimiter } from '../../infrastructure/RateLimiter.mjs'
import RateLimiterMiddleware from '../Security/RateLimiterMiddleware.mjs'
import AnalyticsRegistrationSourceMiddleware from '../Analytics/AnalyticsRegistrationSourceMiddleware.mjs'

const rateLimiter = new RateLimiter('create-project-from-template', {
  points: 20,
  duration: 60,
})

const templateStatusRateLimiter = new RateLimiter('template-status', {
  points: 20,
  duration: 60,
})

export default {
  rateLimiter,
  templateStatusRateLimiter,
  apply(app) {
    app.get(
      '/project/templates',
      AuthenticationController.requireLogin(),
      TemplatesController.getLocalTemplates
    )

    app.post(
      '/project/:projectId/template',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(templateStatusRateLimiter),
      TemplatesController.setTemplateStatus
    )

    app.delete(
      '/project/:projectId/template',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(templateStatusRateLimiter),
      TemplatesController.removeTemplate
    )

    app.get(
      '/project/:projectId/template/shares',
      AuthenticationController.requireLogin(),
      TemplatesController.getTemplateShares
    )

    app.post(
      '/project/:projectId/template/shares',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(templateStatusRateLimiter),
      TemplatesController.shareTemplate
    )

    app.delete(
      '/project/:projectId/template/shares/:userId',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(templateStatusRateLimiter),
      TemplatesController.unshareTemplate
    )

    app.get(
      '/project/new/template/:Template_version_id',
      (req, res, next) =>
        AnalyticsRegistrationSourceMiddleware.setSource(
          'template',
          req.params.Template_version_id
        )(req, res, next),
      TemplatesMiddleware.saveTemplateDataInSession,
      AuthenticationController.requireLogin(),
      TemplatesController.getV1Template,
      AnalyticsRegistrationSourceMiddleware.clearSource()
    )

    app.post(
      '/project/new/template',
      AuthenticationController.requireLogin(),
      RateLimiterMiddleware.rateLimit(rateLimiter),
      TemplatesController.createProjectFromV1Template
    )
  },
}
