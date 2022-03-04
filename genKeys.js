const EC = require('elliptic').ec, ec = new EC('secp256k1');
const keyPair = ec.genKeyPair();
console.log("Add these to your config file for the node, and make sure to back them up somewhere else as well!\n");
console.log('Public key: ', keyPair.getPublic("hex"));
console.log('Private key: ', keyPair.getPrivate("hex"));
