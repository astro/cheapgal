var fs = require('fs');
var spawn = require('child_process').spawn;
var async = require('async');
var Mustache = require('mustache');
var express = require('express');
var app = express();

var config = JSON.parse(fs.readFileSync('config.json'));
var template = fs.readFileSync('template.html', { encoding: 'utf8' });

function getPhotos(cb) {
    fs.readdir(config.path, function(err, files) {
        if (err)
            return cb(err);

        async.mapSeries(files, function(file, cb) {
            var path = config.path + "/" + file;
            fs.stat(path, function(err, stats) {
                if (err)
                    return cb(err);

                if (!/^\./.test(file) && stats.isFile()) {
                    date = stats.ctime.getTime();
                    cb(null, {
                        date: date,
                        path: path,
                        file: file
                    });
                } else {
                    cb(null);
                }
            });
        }, function(err, datesFiles) {
            if (err)
                return cb(err);

            var files = datesFiles.filter(function(df) {
                return !!df;
            }).sort(function(df1, df2) {
                return df1.date - df2.date;
            });
            cb(null, files);
        });
    });
}

app.get('/', function (req, res) {
    async.series([function(cb) {
        res.writeHead(200, {
            'Content-Type': 'text/html'
        });
        cb();
    }, function(cb) {
        getPhotos(function(err, photos) {
            if (photos) {
                res.write(Mustache.render(template, {
                    title: config.title,
                    photos: photos
                }));
            }
            cb(err);
        });
    }], function(err) {
        if (err)
            console.error(err && err.stack || err);
        res.end();
    });
});

var thumbGenerator = async.queue(function(task, cb) {
    fs.stat(task.thumbPath, function(err, stats) {
        if (err && err.code === 'ENOENT') {
            var convert = spawn("convert", [task.path, "-resize", "192x128", task.thumbPath]);
            convert.on('close', function(code) {
                cb(code == 0 ? null : new Error("Convert exited with: " + code));
            });
        } else if (stats) {
            cb();
        } else {
            cb(err);
        }
    });
}, 4);

var extTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'png': 'image/png',
    'webp': 'image/webp'
};
function getFileType(file) {
    var type, m;
    if ((m = file.toLowerCase().match(/\.([a-z]{2,5})$/))) {
        type = extTypes[m[1]];
    }
    return type;
}
app.get('/photos/:name', function (req, res) {
    var file = req.params.name;
    var type = getFileType(file);
    if (type) {
        res.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'max-age=2592000',
            'Expires': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toGMTString()
        });
        fs.readFile(config.path + "/" + file, function(err, data) {
            if (data)
                res.write(data);
            res.end();
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

app.get('/thumbs/:name', function (req, res) {
    var file = req.params.name;
    var type = getFileType(file);
    if (type) {
        // TODO: cache headers
        res.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'max-age=2592000',
            'Expires': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toGMTString()
        });
        var path = config.path + "/" + file;
        var thumbPath = config.thumbPath + "/" + file;
        thumbGenerator.push({
            path: path,
            thumbPath: thumbPath
        }, function(err) {
            fs.readFile(thumbPath, function(err, data) {
                if (data)
                    res.write(data);
                res.end();
            });
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

app.listen(config.port);
