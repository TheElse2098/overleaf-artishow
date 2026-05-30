import logger from '@overleaf/logger'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import Settings from '@overleaf/settings'
import TpdsUpdateSender from '../ThirdPartyDataStore/TpdsUpdateSender.mjs'
import TpdsProjectFlusher from '../ThirdPartyDataStore/TpdsProjectFlusher.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import SystemMessageManager from '../SystemMessages/SystemMessageManager.mjs'
import ProjectGetter from '../Project/ProjectGetter.mjs'
import Modules from '../../infrastructure/Modules.mjs'
import Features from '../../infrastructure/Features.mjs'
import { expressify } from '@overleaf/promise-utils'
import mongodb from '../../infrastructure/mongodb.mjs'

const { db, ObjectId } = mongodb
const readdir = promisify(fs.readdir)
const stat = promisify(fs.stat)

async function dirSize(directoryPath) {
  let totalSize = 0;
  const entries = await readdir(directoryPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      totalSize += await dirSize(fullPath)
    } else if (entry.isFile()) {
      const fileStat = await stat(fullPath)
      totalSize += fileStat.size
    }
  }
  return totalSize
}

async function getUserId(projectId) {
  try {
    const project = await db.projects.findOne(
      { _id: new ObjectId(projectId) },
      { projection: { owner_ref: 1 } }
    )
    if (!project) return null
    return project.owner_ref ? project.owner_ref.toString() : null
  } catch (err) {
    console.error('Failed to fetch userId for projectId', projectId, err)
    throw err
  }
}

async function getEmail(userId) {
  try {
    const user = await db.users.findOne(
      { _id: new ObjectId(userId) },
      { projection: { email: 1 } }
    )
    return user ? user.email : null
  } catch (err) {
    console.error('Failed to fetch email for userId', userId, err)
    throw err
  }
}

async function getUserFilesDiskUsage(userFilesDir) {
  let userUsageMap = {} // userId -> summed bytes
  let entries
  try {
    entries = await readdir(userFilesDir, { withFileTypes: true })
  } catch (err) {
    // handle error or return empty object
    return {}
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    // filename pattern: "${projectId}_${userId}"
    const match = entry.name.match( /^([^_]+)_([^_]+)$/)
    if (!match) continue
    const projectId = match[1]
    const userId = await getUserId(projectId)
    const email = await getEmail(userId)
    const fullPath = path.join(userFilesDir, entry.name)
    let fileStat
    try {
      fileStat = await stat(fullPath)
    } catch (err) {
      continue
    }
    
    if (!userUsageMap[email]) userUsageMap[email] = 0
	  {
            userUsageMap[email] += fileStat.size
	  }
  }
  return userUsageMap 
}


const AdminController = {
  _sendDisconnectAllUsersMessage: delay => {
    return EditorRealTimeController.emitToAll(
      'forceDisconnect',
      'Sorry, we are performing a quick update to the editor and need to close it down. Please refresh the page to continue.',
      delay
    )
  },
  index: expressify(async (req, res, next) => {
    let url
    const openSockets = {}
    for (url in http.globalAgent.sockets) {
      openSockets[`http://${url}`] = http.globalAgent.sockets[url].map(
        socket => socket._httpMessage.path
      )
    }

    for (url in https.globalAgent.sockets) {
      openSockets[`https://${url}`] = https.globalAgent.sockets[url].map(
        socket => socket._httpMessage.path
      )
    }
    const targetDir = '/var/lib/overleaf/data'
    const historyDir = '/var/lib/overleaf/data/history'
    const userFilesDir = '/var/lib/overleaf/data/user_files'
    let directorySizeBytes = null
    let historySizeBytes = null
    let userFilesUsage = null
    try {
      directorySizeBytes = await dirSize(targetDir)
      historySizeBytes = await dirSize(historyDir)
      userFilesUsage = await getUserFilesDiskUsage(userFilesDir)
    } catch (err) {
      logger.error('Failed to get directory size', { error: err, targetDir })
      directorySizeBytes = null
    }

    const systemMessages =
      await SystemMessageManager.promises.getMessagesFromDB()

    const privilegesMatrixResults = await Modules.promises.hooks.fire(
      'getPrivilegesMatrix'
    )

    const privilegesMatrix = privilegesMatrixResults[0] || null

    const toRender = {
      title: 'System Admin',
      openSockets,
      systemMessages,
      privilegesMatrix,
    }

    if (Features.hasFeature('saas')) {
      const debugProjects = await ProjectGetter.promises.findAllDebugProjects(
        'name lastUpdated owner_ref'
      )
      toRender.debugProjects = debugProjects
    }
    res.render('admin/index', toRender)
  }),

  disconnectAllUsers: (req, res) => {
    logger.warn('disconecting everyone')
    const delay = (req.query && req.query.delay) > 0 ? req.query.delay : 10
    AdminController._sendDisconnectAllUsersMessage(delay)
    res.redirect('/admin#open-close-editor')
  },

  openEditor(req, res) {
    logger.warn('opening editor')
    Settings.editorIsOpen = true
    res.redirect('/admin#open-close-editor')
  },

  closeEditor(req, res) {
    logger.warn('closing editor')
    Settings.editorIsOpen = req.body.isOpen
    res.redirect('/admin#open-close-editor')
  },

  flushProjectToTpds(req, res, next) {
    TpdsProjectFlusher.flushProjectToTpds(req.body.project_id, error => {
      if (error) {
        return next(error)
      }
      res.sendStatus(200)
    })
  },

  pollDropboxForUser(req, res) {
    const { user_id: userId } = req.body
    TpdsUpdateSender.pollDropboxForUser(userId, () => res.sendStatus(200))
  },

  createMessage(req, res, next) {
    SystemMessageManager.createMessage(req.body.content, function (error) {
      if (error) {
        return next(error)
      }
      res.redirect('/admin#system-messages')
    })
  },

  clearMessages(req, res, next) {
    SystemMessageManager.clearMessages(function (error) {
      if (error) {
        return next(error)
      }
      res.redirect('/admin#system-messages')
    })
  },
  
  
}

export default AdminController
