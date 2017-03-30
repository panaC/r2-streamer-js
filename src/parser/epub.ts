// package.json
// with dependencies:
// "@types/node"
// ==>
// const StreamZip = require("node-stream-zip");

// src/declarations.d.ts
// with:
// declare module '*';
// ==>
import * as StreamZip from "node-stream-zip";

import * as mime from "mime-types";
import * as path from "path";
import * as slugify from "slugify";

import { Link } from "../models/publication-link";

import { Metadata } from "../models/metadata";

import { Publication } from "../models/publication";

export class EpubParser {

    public Parse(filePath: string): Promise<Publication> {

        const that = this;

        return new Promise<Publication>((resolve, reject) => {

            const zip = new StreamZip({
                file: filePath,
                storeEntries: true,
            });

            zip.on("error", (err: any) => {
                console.log("--ZIP: error");
                console.log(err);

                reject(err);
            });

            zip.on("entry", (entry: any) => {
                console.log("--ZIP: entry");
                console.log(entry.name);
            });

            zip.on("extract", (entry: any, file: any) => {
                console.log("--ZIP: extract");
                console.log(entry.name);
                console.log(file);
            });

            zip.on("ready", () => {
                console.log("--ZIP: ready");
                console.log(zip.entriesCount);

                const entries = zip.entries();
                console.log(entries);

                const publication = new Publication();
                publication.Metadata = new Metadata();
                publication.Metadata.Identifier = path.basename(filePath);
                publication.Metadata.Title = that.filePathToTitle(filePath);

                publication.AddToInternal("type", "epub");
                // publication.AddToInternal("epub", zip);

                if (zip.entriesCount) {
                    Object.keys(entries).map((entryName) => {
                        console.log("++ZIP: entry");

                        const entry = entries[entryName];
                        console.log(entry.name);

                        console.log(entryName);

                        const link = new Link();
                        link.Href = entryName;

                        const mediaType = mime.lookup(entryName);
                        if (mediaType) {
                            console.log(mediaType);

                            link.TypeLink = mediaType;
                        } else {
                            console.log("!!!!!! NO MEDIA TYPE?!");
                        }

                        if (!publication.Spine) {
                            publication.Spine = Array<Link>();
                        }
                        publication.Spine.push(link);

                        // if (entry.size < 2048
                        //     && (entryName.toLowerCase().endsWith(".html")
                        //         || entryName.toLowerCase().endsWith(".xhtml")
                        //         || entryName.toLowerCase().endsWith(".css")
                        //         || entryName.toLowerCase().endsWith(".xml")
                        //         || entryName.toLowerCase().endsWith(".opf")
                        //         || entryName.toLowerCase().endsWith(".ncx")
                        //     )) {

                        //     const entryData = zip.entryDataSync(entryName);
                        //     console.log(entryData.toString("utf8"));
                        // }
                    });
                }

                resolve(publication);
            });
        });
    }

    private filePathToTitle(filePath: string): string {
        const fileName = path.basename(filePath);
        return slugify(fileName, "_").replace(/[\.]/g, "_");
    }
}