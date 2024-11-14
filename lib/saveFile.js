const fs = require('fs');
const axios = require('axios');
/**
 * Save file to local disk. Uses streams for efficiency.
 * @param filePath
 * @param url
 */
function saveFile(filePath, url){
    return new Promise(async (resolve, reject)=> {
        const writer = fs.createWriteStream(filePath);
        const response = await axios.get(url, {responseType: 'stream'});
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

module.exports = saveFile;
