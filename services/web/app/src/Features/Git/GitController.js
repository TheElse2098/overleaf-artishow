const { fetchNothing } = require('@overleaf/fetch-utils')
const Settings = require('@overleaf/settings')



async commit(req, res) {
    const { projectId, userId, message } = req.body   // userId = owner injecté par le middleware
    console.log("Commit with message: " + message)
    if (!message || message.trim() === "") {
        console.log("Empty commit messages are not permitted")
        return HttpErrorHandler.gitMethodError(req, res, "Please add a commit message before committing.")
    }
    
    try {
        await fetchNothing(`${Settings.apis.gitService.url}/commit`, {
        method: 'POST',
        json: { projectId, userId, message: message.trim() },
        })
        res.sendStatus(200)
    } catch (err) {
        HttpErrorHandler.gitMethodError(req, res, err?.message || String(err))
  }
},