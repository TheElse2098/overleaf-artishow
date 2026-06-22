import '@overleaf/metrics/initialize.js'
import settings from '@overleaf/settings'
import { createServer } from './app/js/server.js'

const { server } = await createServer()
server.listen(settings.internal.git.port, settings.internal.git.host)
