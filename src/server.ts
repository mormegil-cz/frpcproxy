/// <reference path="../libs/express/express.d.ts" />

import * as express from 'express';
import FrpcProxy from './frpcproxy/frpcproxy';

var config = require('./config.js');
if (!config || !config.endpoints) {
    console.log(config);
    throw Error('Endpoint configuration missing');
}

var app = express();

var frpcproxy = new FrpcProxy();

// app.use('/test', express.static('test'));

app.post('/frpcproxy/*', function (req, res) {
    var endpoint = req.params[0];
    var endpointConfig = config.endpoints[endpoint];
    if (!endpointConfig) {
        console.log('Unknown proxy endpoint "%s"', req.params[0]);
        res.status(404).end('Unknown proxy endpoint');
        return;
    }

    frpcproxy.process(endpointConfig.hostname, endpointConfig.port, endpointConfig.path, endpointConfig.method, req, res);
});

app.listen(3000, function () {
    console.log('FRPC proxy listening on port 3000!');
});
