const fs = require('fs-extra');
const path = require('path');
const outputPath = "/var/lib/overleaf/data/compiles/"
const dataPath = "/var/lib/overleaf/data/git/"
const simpleGit = require('simple-git')
const EditorController = require('../Editor/EditorController')
const ClsiCookieManager = require('../Compile/ClsiCookieManager');

function resetFolder(src) {
  if (!fs.existsSync(src)) return;
  const stats = fs.lstatSync(src);
  if (!stats.isDirectory()) return;
  fs.readdirSync(src).forEach((file) => {
    const filePath = path.join(src, file);
    fs.lstatSync(filePath).isDirectory()
      ? fs.rmdirSync(filePath, { recursive: true })
      : fs.unlinkSync(filePath);
  });
}
async function gitUpdate(projectId, ownerId) {
    console.log("Copying")
    const src = outputPath + projectId + "-" + ownerId
    const dest = dataPath + projectId + "-" + ownerId
    const bannedFiles = ['output.aux', 'output.fdb_latexmk', 'output.fls', 'output.log', 'output.pdf', 'output.stdout', 'output.synctex.gz', '.project-sync-state'];

    resetFolder(dest)

      fs.copy(src, dest, err => {

        if (err) {
          console.error(`Error when copying ${src} to ${dest}:`, err)
          return
        }

        fs.readdir(dest, (err, files) => {
        if (err) {
            console.error(`Erreur when reading folder: ${err}`)
            return
        }

        files.forEach(file => {

            const filePath = path.join(dest, file)

            fs.stat(filePath, (err, stats) => {

                if (err) {
                    console.error(`Error getting stats of file: ${filePath}, ${err}`);
                    return;
                }

                if (bannedFiles.includes(path.basename(filePath))) {
                   fs.remove(filePath, err => {
                        if (err) {
                            console.error(`Couldn't delete file: ${filePath}, ${err}`)
                            return
                        }
                    });
                }
           });
       });
    console.log("Source: " + src)
    console.log("Destination: " + dest)
     })
    })
}

module.exports = { gitUpdate };

