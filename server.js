var setting = require('./config')
var azure = require('azure-storage');
var aws = require('aws-sdk');
var http = require('http');
var sharp = require('sharp');
var path = require("path")
var fs = require("fs")
var sizePattern = /^\/(?:s(\d{0,4})|(?:w(\d{1,4}))?(?:h(\d{1,4}))?)(?:\-(c|m|s))?(?:-(g)?(?:b(\d{1,4}))?)?\/(.+)$/
var blobService = null
if(setting.azure.account)
    blobService = azure.createBlobService(setting.azure.account, setting.azure.key);

const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
aws.config.update({
    accessKeyId: setting.aws.account,
    secretAccessKey: setting.aws.key,
    region: setting.aws.region
});
var s3 = new aws.S3();


module.exports = function(port) {
    var server = http.createServer(async function(request, response) {
        if(request.url=='/healthcheck'){
            healthcheck(response);
            return;
        }
        var m = request.url.match(sizePattern)
        if (m == null) {
            throw404(response);
            return;
        }
        var w = null;
        var h = null;
        if (m[1] != undefined) {
            w = parseInt(m[1])
            h = w
        }
        if (m[2] != undefined) {
            w = parseInt(m[2])
        }
        if (m[3] != undefined) {
            h = parseInt(m[3])
        }
        filepath = m[7]
        var transform = sharp()
        if (m[4]) {
            switch (m[4]) {
                case "m":
                    transform = transform.resize(w, h).max();
                    break;
                default:
                    transform = transform.resize(w, h,{position: sharp.strategy.center});
                    break;
                
            }
        } else {
            transform = transform.resize(w, h, {
                background:{
                r: 255,
                g: 255,
                b: 255,
                alpha: 0
                }
            })
        }

        if (m[5] != undefined) {
            transform = transform.grayscale()
        }
        if (m[6] != undefined) {
            transform = transform.blur(parseInt(m[6]));
        }
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'GET');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (setting.default === 'azure') {
            getFromAzure(transform, filepath, response)
        }else if(setting.default === 'gcs'){
            getFromGCS(transform, filepath, response)
        } else {
            getFromAWS(transform, filepath, response)
        }

    })
    function healthcheck(response){
        response.writeHead(200);
        response.end('ok');
        return;
    }
    function getFromAWS(transform, filepath, response) {
        var d = require('domain').create();
        d.on('error', function(error){
            
            if (error) {
                if (error.statusCode === 404) {
                    throw404(response)
                } else {
                    throw500(response)
                }
            }
        });
        d.run(function() {
            s3.getObject({
                    Bucket: setting.aws.container,
                    Key: filepath
                })
                .createReadStream()
                .pipe(transform)
                .pipe(response);
        })

    }

    function getFromAzure(transform, filepath, response) {
        var d = require('domain').create();
        d.on('error', function(error){
            if (error) {
                if (error.statusCode === 404) {
                    throw404(response)
                } else {
                    throw500(response)
                }
            }
        });
        d.run(function() {
            blobService
            .createReadStream(setting.azure.container, filepath)
            .pipe(transform)
            .pipe(response);
        });
            
    }
    async function getFromGCS(transform, filepath, response) {
        const filename = "/tmp/" + path.basename(filepath)
        await storage
          .bucket(setting.gcs.bucket)
          .file(filepath)
          .download({destination: filename})
        fs.createReadStream(filename)
          .pipe(transform)
          .pipe(response);
          
    }

    function throw404(response) {
        response.writeHead(404);
        response.end();
        return;
    }

    function throw500(response) {
        response.writeHead(500);
        response.end();
        return;
    }
    server.on("connection", function(socket) {

        socket.setNoDelay(true);

    });
    server.listen(port);
}
