import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import AdminUserStatsController from './AdminUserStatsController.mjs'

// "Refresh now" kicks off a heavy background recompute, so keep it well throttled.
const refreshRateLimiter = new RateLimiter('admin-user-stats-refresh', {
  points: 5,
  duration: 60,
})

export default {
  apply(webRouter) {
    webRouter.get(
      '/admin/user-stats',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      AdminUserStatsController.renderPage
    )

    webRouter.get(
      '/admin/user-stats/data',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      AdminUserStatsController.getData
    )

    webRouter.post(
      '/admin/user-stats/refresh',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      RateLimiterMiddleware.rateLimit(refreshRateLimiter),
      AdminUserStatsController.refresh
    )
  },
}
