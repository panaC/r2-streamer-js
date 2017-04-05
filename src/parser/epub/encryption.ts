import { EncryptedData } from "./encryption-data";

import {
    XmlItemType,
    XmlObject,
    XmlXPathSelector,
} from "../../xml-js-mapper";

@XmlObject({
    ds: "http://www.w3.org/2000/09/xmldsig#",
    enc: "http://www.w3.org/2001/04/xmlenc#",
    encryption: "urn:oasis:names:tc:opendocument:xmlns:container",
    ns: "http://www.idpf.org/2016/encryption#compression",
})
export class Encryption {

    @XmlXPathSelector("/encryption:encryption/enc:EncryptedData")
    @XmlItemType(EncryptedData)
    public EncryptedData: EncryptedData[];
}