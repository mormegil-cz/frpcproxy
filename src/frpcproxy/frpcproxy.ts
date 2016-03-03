import * as express from 'express';
import * as http from "http";
import * as net from "net";
import FRPC from "./frpc";

export default class FrpcProxy {
    private frpcSerializer = new FRPC();
    private httpAgent = new http.Agent();

    public process(hostname: string, port: number, path: string, calledMethod: string, req: express.Request, res: express.Response) {
        if (req.header('Content-Type') !== 'application/json') {
            res.status(415).end('application/json request content required\n');
            return;
        }
        if (!req.accepts('application/json')) {
            res.status(406).end('Only application/json response available\n');
            return;
        }

        var requestParts: Buffer[] = [];
        req.on('data', (chunk: Buffer) => requestParts.push(chunk));
        req.on('end', () => {
            var requestJson = Buffer.concat(requestParts).toString('utf-8');
            var requestData: any[];
            try {
                requestData = JSON.parse(requestJson, (key, value) => {
                    if (typeof value !== 'string') return value;
                    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)) return value;
                    // crude, implementation dependent for slightly wrong values
                    var parsedDate = Date.parse(value);
                    if (Number.isNaN(parsedDate)) return value;
                    return new Date(parsedDate);
                });
            } catch(error) {
                res.status(400).end('Request body is not a valid JSON\n');
                return;
            }

            if (typeof requestData !== 'object' || !Array.isArray(requestData)) {
                res.status(400).end('Request must contain the parameter array');
                return;
            }

            var frpcData = this.frpcSerializer.serializeCall(calledMethod, requestData);
            var frpcBytes = new Buffer(frpcData);

            var responseParts: Buffer[] = [];
            var proxiedRequest = http.request({
                method: 'POST',
                hostname: hostname,
                port: port,
                path: path,
                headers: {
                    'Content-Type': 'application/x-frpc',
                    'Accept': 'application/x-frpc',
                    'Content-Length': frpcBytes.length
                },
                agent: this.httpAgent
            }, proxiedResponse => {
                if (proxiedResponse.statusCode != 200) {
                    proxiedResponse.resume();
                    res.status(502).end('Error received from upstream server: ' + proxiedResponse.statusCode + ' ' + proxiedResponse.statusMessage);
                    return;
                }
                if (proxiedResponse.headers['content-type'] !== 'application/x-frpc') {
                    res.setHeader('Content-Type', proxiedResponse.headers['content-type']);
                    res.status(502);
                    proxiedResponse.pipe(res)
                    return;
                }
                proxiedResponse.on('data', (chunk: Buffer) => {
                    responseParts.push(chunk);
                });
                proxiedResponse.on('end', () => {
                    var responseBytes = Array.from(Buffer.concat(responseParts));
                    var parsedResponse: any;
                    try {
                        parsedResponse = this.frpcSerializer.parse(responseBytes);
                    } catch (error) {
                        res.status(502).end('Invalid FRPC response received from upstream server');
                        return;
                    }

                    var responseJson = JSON.stringify(parsedResponse);
                    res.setHeader('Content-Type', 'application/json');
                    //res.setHeader('Content-Length', responseJson.length.toString());
                    res.status(200).send(responseJson).end();
                });
            });
            // TODO: Upstream connection failures => 504  
            proxiedRequest.on('error', (error: any) => {
                res.status(502).end('Request to upstream server failed: ' + error);
            });

            proxiedRequest.write(frpcBytes);
            proxiedRequest.end();
        });
    }
}
