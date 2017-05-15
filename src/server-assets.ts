import * as crypto from "crypto";
import * as debug_ from "debug";
import * as path from "path";

import * as express from "express";
import * as mime from "mime-types";

import { Link } from "./models/publication-link";
import { EpubParsePromise } from "./parser/epub";
import { IZip, streamToBufferPromise } from "./parser/zip";
import { Server } from "./server";

const debug = debug_("r2:server:assets");

export function serverAssets(server: Server, routerPathBase64: express.Router) {

    const routerAssets = express.Router({ strict: false });
    // routerAssets.use(morgan("combined"));

    routerAssets.get("/",
        async (req: express.Request, res: express.Response) => {

            if (!req.params.pathBase64) {
                req.params.pathBase64 = (req as any).pathBase64;
            }
            if (!req.params.asset) {
                req.params.asset = (req as any).asset;
            }

            const pathBase64Str = new Buffer(req.params.pathBase64, "base64").toString("utf8");

            let publication = server.cachedPublication(pathBase64Str);
            if (!publication) {
                publication = await EpubParsePromise(pathBase64Str);
                server.cachePublication(pathBase64Str, publication);
            }
            // dumpPublication(publication);

            if (!publication.Internal) {
                const err = "No publication internals!";
                debug(err);
                res.status(500).send("<html><body><p>Internal Server Error</p><p>"
                    + err + "</p></body></html>");
                return;
            }

            const zipInternal = publication.Internal.find((i) => {
                if (i.Name === "zip") {
                    return true;
                }
                return false;
            });
            if (!zipInternal) {
                const err = "No publication zip!";
                debug(err);
                res.status(500).send("<html><body><p>Internal Server Error</p><p>"
                    + err + "</p></body></html>");
                return;
            }
            const zip = zipInternal.Value as IZip;

            const pathInZip = req.params.asset;
            // FIX_LINK_HREF_PATHS_RELATIVE_TO_ZIP_ROOT
            // const opfInternal = publication.Internal.find((i) => {
            //     if (i.Name === "rootfile") {
            //         return true;
            //     }
            //     return false;
            // });
            // const rootfilePath = opfInternal ? opfInternal.Value as string : undefined;
            // if (rootfilePath &&
            //     !zip.hasEntry(pathInZip)) {
            //     // FIRST FAIL ...
            //     // let's try to adjust the path, make it relative to the OPF package
            //     // (support for legacy incorrect implementation)
            //     pathInZip = path.join(path.dirname(rootfilePath), pathInZip)
            //         .replace(/\\/g, "/");
            // }

            if (!zip.hasEntry(pathInZip)) {
                const err = "Asset not in zip! " + pathInZip;
                debug(err);
                res.status(500).send("<html><body><p>Internal Server Error</p><p>"
                    + err + "</p></body></html>");
                return;
            }

            let link: Link | undefined;

            if (publication.Resources
                && pathInZip.indexOf("META-INF/") !== 0
                && !pathInZip.endsWith(".opf")) {

                // FIX_LINK_HREF_PATHS_RELATIVE_TO_ZIP_ROOT
                // const relativePath = path.relative(path.dirname(rootfilePath), pathInZip)
                //     .replace(/\\/g, "/");
                const relativePath = pathInZip;

                link = publication.Resources.find((l) => {
                    if (l.Href === relativePath) {
                        return true;
                    }
                    return false;
                });
                if (!link) {
                    link = publication.Spine.find((l) => {
                        if (l.Href === relativePath) {
                            return true;
                        }
                        return false;
                    });
                }
                if (!link) {
                    const err = "Asset not declared in publication spine/resources!";
                    debug(err);
                    res.status(500).send("<html><body><p>Internal Server Error</p><p>"
                        + err + "</p></body></html>");
                    return;
                }
            }

            const mediaType = mime.lookup(pathInZip);

            const zipStream = await zip.entryStreamPromise(pathInZip);
            // TODO: zipStream.pipe(res);
            let zipData = await streamToBufferPromise(zipStream);

            if (link && link.Properties && link.Properties.Encrypted) {
                if (link.Properties.Encrypted.Algorithm === "http://www.idpf.org/2008/embedding") {

                    let pubID = publication.Metadata.Identifier;
                    pubID = pubID.replace(/\s/g, "");

                    const checkSum = crypto.createHash("sha1");
                    checkSum.update(pubID);
                    // const hash = checkSum.digest("hex");
                    // console.log(hash);
                    const key = checkSum.digest();

                    const prefixLength = 1040;
                    const zipDataPrefix = zipData.slice(0, prefixLength);

                    for (let i = 0; i < prefixLength; i++) {
                        /* tslint:disable:no-bitwise */
                        zipDataPrefix[i] = zipDataPrefix[i] ^ (key[i % key.length]);
                    }

                    const zipDataRemainder = zipData.slice(prefixLength);
                    zipData = Buffer.concat([zipDataPrefix, zipDataRemainder]);

                } else if (link.Properties.Encrypted.Algorithm === "http://ns.adobe.com/pdf/enc#RC") {

                    let pubID = publication.Metadata.Identifier;
                    pubID = pubID.replace("urn:uuid:", "");
                    pubID = pubID.replace(/-/g, "");
                    pubID = pubID.replace(/\s/g, "");

                    const key = [];
                    for (let i = 0; i < 16; i++) {
                        const byteHex = pubID.substr(i * 2, 2);
                        const byteNumer = parseInt(byteHex, 16);
                        key.push(byteNumer);
                    }

                    const prefixLength = 1024;
                    const zipDataPrefix = zipData.slice(0, prefixLength);

                    for (let i = 0; i < prefixLength; i++) {
                        /* tslint:disable:no-bitwise */
                        zipDataPrefix[i] = zipDataPrefix[i] ^ (key[i % key.length]);
                    }

                    const zipDataRemainder = zipData.slice(prefixLength);
                    zipData = Buffer.concat([zipDataPrefix, zipDataRemainder]);

                } else if (link.Properties.Encrypted.Algorithm
                    === "http://www.w3.org/2001/04/xmlenc#aes256-cbc") {
                    // TODO LCP userKey --> contentKey
                }
            }

            if (req.query.show) {
                const isText = mediaType && (
                    mediaType.indexOf("text/") === 0 ||
                    mediaType.indexOf("application/xhtml") === 0 ||
                    mediaType.indexOf("application/xml") === 0 ||
                    mediaType.indexOf("application/json") === 0 ||
                    mediaType.indexOf("application/svg") === 0 ||
                    mediaType.indexOf("application/smil") === 0 ||
                    mediaType.indexOf("+json") > 0 ||
                    mediaType.indexOf("+smil") > 0 ||
                    mediaType.indexOf("+svg") > 0 ||
                    mediaType.indexOf("+xhtml") > 0 ||
                    mediaType.indexOf("+xml") > 0);

                res.status(200).send("<html><body>" +
                    "<h1>" + path.basename(pathBase64Str) + "</h1>" +
                    "<h2>" + mediaType + "</h2>" +
                    (isText ?
                        ("<p><pre>" +
                            zipData.toString("utf8").replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/"/g, "&quot;")
                                .replace(/'/g, "&apos;") +
                            "</pre></p>")
                        : "<p>BINARY</p>"
                    ) + "</body></html>");
            } else {
                res.setHeader("Access-Control-Allow-Origin", "*");

                res.setHeader("Cache-Control", "public,max-age=86400");

                // res.set("Content-Type", mediaType);
                if (mediaType) {
                    res.type(mediaType);
                }

                res.status(200).send(zipData);

                // if (isText) {
                //     res.status(200).send(zipData.toString("utf8"));
                // } else {
                //     res.status(200).end(zipData, "binary");
                // }
            }
        });

    routerPathBase64.param("asset", (req, _res, next, value, _name) => {
        (req as any).asset = value;
        next();
    });

    routerPathBase64.use("/:pathBase64/:asset(*)", routerAssets);
}
