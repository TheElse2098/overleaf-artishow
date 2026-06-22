import simpleGit from 'simple-git'

const DATA_PATH = '/var/lib/overleaf/data/git/'

function getGitForProject(projectId, userId) {
  const repoPath = DATA_PATH + projectId + '-' + userId  //attention pas de middleware ici : TODO 
  return simpleGit({
    baseDir: repoPath,
    config: [`safe.directory=${repoPath}`, 'core.autocrlf=false', 'core.eol=lf'],
  })
}

export async function commit(projectId, userId, message) {
  const git = getGitForProject(projectId, userId)
  await git.addConfig('user.name', 'overleaf')
  await git.addConfig('user.email', 'overleaf@overleaf.com')
  await git.commit(message)
}


export async function push(projectId, userId, gitInfo) {
    const git = getGitForProject(projectId, userId)
    if (gitInfo?.token && gitInfo?.remoteUrl) {
        const authUrl = buildAuthentificatedUrl(gitInfo.remoteUrl, gitInfo.token, gitInfo.tokenType)
        await git.push(authUrl, gitInfo.branch || null)
    } else {
        await withSshKey(userId, () => git.push('origin', gitInfo?.branch || null))
    }
}
