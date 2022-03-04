const crypto = require("crypto"), SHA256 = message => crypto.createHash("SHA256").update(message).digest("hex");
const inquirer = require('inquirer');
const {Block, Blockchain, Transaction, Plutus} = require("./plutus");
const EC = require("elliptic").ec, ec = new EC("secp256k1");
const WS = require("ws");
const readline = require('readline');
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const MINT_PRIVATE_ADDRESS = "0700a1ad28a20e5b2a517c00242d3e25a88d84bf54dce9e1733e6096e6d6495e";
const MINT_KEY_PAIR = ec.keyFromPrivate(MINT_PRIVATE_ADDRESS, "hex");
const MINT_PUBLIC_ADDRESS = MINT_KEY_PAIR.getPublic("hex");

const config = require("./data.json");
const PORT = config.port;
const PEERS = config.peers;
const MY_ADDRESS = config.address;

const publicKey = config.publicKey;
const privateKey = config.privateKey;
const keyPair = ec.keyFromPrivate(privateKey, "hex");

const server = new WS.Server({ port: PORT });
console.log("Listening on PORT", PORT);
process.on("uncaughtException", err => console.log(err));

let opened = [], connected = [];
let amount = 0;
let toAddress = "";
let check = [];
let checked = [];
let checking = false;
let tempChain = new Blockchain();
var input = process.stdin;

input.setEncoding('utf-8')
PEERS.forEach(peer => connect(peer));

const util = require('util'),
	question = util.promisify(rl.question);

function produceMessage(type, data) {
    return {type, data}
}
function sendMessage(message) {
    opened.forEach(node => {
        node.socket.send(JSON.stringify(message));
    });
}

server.on("connection", async(socket, req) => {
    socket.on("message", message => {
        const _message = JSON.parse(message);
        switch(_message.type) {
            case "TYPE_HANDSHAKE":
                const nodes = _message.data;
                nodes.forEach(node => connect(node))
                break;
            case "TYPE_CREATE_TRANSACTION":
                const transaction = _message.data;

                Plutus.addTransaction(transaction);
                break;
            case "TYPE_REPLACE_CHAIN":
                const [ newBlock, newDiff ] = _message.data;
                const ourTx = [...Plutus.transactions.map(tx => JSON.stringify(tx))];
                const theirTx = [...newBlock.data.filter(tx => tx.from !== MINT_PUBLIC_ADDRESS).map(tx => JSON.stringify(tx))];
                const n = theirTx.length;
                if (newBlock.prevHash !== Plutus.getLastBlock().prevHash) {
                    for (let i = 0; i < n; i++) {
                        const index = ourTx.indexOf(theirTx[0]);
                        if (index === -1) break;
                        ourTx.splice(index, 1);
                        theirTx.splice(0, 1);
                    }
                    if (
                        theirTx.length === 0 &&
                        SHA256(Plutus.getLastBlock().hash + newBlock.timestamp + JSON.stringify(newBlock.data) + newBlock.nonce) === newBlock.hash &&
                        newBlock.hash.startsWith(Array(Plutus.difficulty + 1).join("0")) &&
                        Block.hasValidTransactions(newBlock, Plutus) &&
                        (parseInt(newBlock.timestamp) > parseInt(Plutus.getLastBlock().timestamp) || Plutus.getLastBlock().timestamp === "") &&
                        parseInt(newBlock.timestamp) < Date.now() &&
                        Plutus.getLastBlock().hash === newBlock.prevHash &&
                        (newDiff + 1 === Plutus.difficulty || newDiff - 1 === Plutus.difficulty)
                    ) {
                        Plutus.chain.push(newBlock);
                        Plutus.difficulty = newDiff;
                        Plutus.transactions = [...ourTx.map(tx => JSON.parse(tx))];
                    }
                } else if (!checked.inclides(JSON.stringify([newBlock.prevHash, Plutus.chain[Plutus.chain.length-2].timestamp || ""]))) {
                    checked.push(JSON.stringify([Plutus.getLastBlock().prevHash, Plutus.chain[Plutus.chain.chain.length-2].timestamp || ""]));
                    const position = Plutus.chain.length - 1;
                    checking = true;
                    sendMessage(produceMessage("TYPE_REQUEST_CHECK", MY_ADDRESS));
                    setTimeout(() => {
                        checking = false;
                        let mostAppeared = check[0];
                        check.forEach(group => {
                            if(check.filter(_group => _group === group).length > check.filter(_group => _group === mostAppeared).length) {
                                mostAppeared = group;
                            }
                        })
                        const group = JSON.parse(mostAppeared)
                        Plutus.chain[position] = group[0];
                        Plutus.transactions = [...group[1]];
                        Plutus.difficulty = group[2]
                        check.splice(0, check.length);
                    }, 5000);
                }
                break;
            case "TYPE_REQUEST_CHECK":
                opened.filter(node => node.address === _message.data)[0].socket.send(
                    JSON.stringify(produceMessage(
                        "TYPE_SEND_CHECK",
                        JSON.stringify([Plutus.getLastBlock(), Plutus.transactions, Plutus.Difficulty])
                    ))
                );
                break;
            case "TYPE_SEND_CHECK":
                if(checking) check.push(_message.data);
                break;
            case "TYPE_SEND_CHAIN":
                const {block, finished} = _message.data;
                if (!finished) {
                    tempchain.chain.push(block);
                } else {
                    tempChain.chain.push(block);
                    if (Blockchain.isValid(tempChain)) {
                        Plutus.chain = tempChain.chain;
                    }
                    tempChain = new Blockchain();
                }
                break;
            case "TYPE_REQUEST_CHAIN":
                const socket = opened.filter(node => node.address === _message.data)[0].socket;
                for (i = 1; i < Plutus.chain.length; i++) {
                    socket.send(JSON.stringify(produceMessage(
                        "TYPE_SEND_CHAIN",
                        {block: Plutus.chain[i],
                            finished: i === Plutus.chain.length - 1
                        }
                    )));
                }
                break;
            case "TYPE_REQUEST_INFO":
                opened.filter(node => node.address === _message.data)[0].socket.send(
                    "TYPE_SEND_INFO",
                    [Plutus.difficulty, Plutus.transactions]
                );
                break;
            case "TYPE_SEND_INFO":
                [Plutus.difficulty, Plutus.transactions] = _message.data;
                break;
        }
    })
});

async function connect(address) {
    if(!connected.find(peerAddress => peerAddress === address) && address !== MY_ADDRESS) {
        const socket = new WS(address);
        socket.on("open", () => {
            socket.send(JSON.stringify(produceMessage("TYPE_HANDSHAKE", [MY_ADDRESS])));
            opened.forEach(node => node.socket.send(JSON.stringify(produceMessage("TYPE_HANDSHAKE", [address]))));
            if(!opened.find(peer => peer.address === address) && address !== MY_ADDRESS) {
                opened.push({socket, address});
            }
            if(!connected.find(peerAddress => peerAddress === address) && address !== MY_ADDRESS) {
                connected.push(address);
            }
        });
        socket.on("close", () => {
            opened.splice(connected.indexOf(address), 1);
            connected.splice(connected.indexOf(address), 1);
        });
    }
}
async function recurloop () {
	const { firstPrompt } = await inquirer.prompt({
		name: 'firstPrompt',
		type: 'list',
		choices: ['help', 'mine', 'readBalance', 'listPeers', 'listPublic', 'listPrivate', 'sendPlutus', 'listBlockchain', 'debug'],
		message: 'What would you like to do?'
	});
	switch (firstPrompt){
		case 'help':
			console.log("Available commands:\nmine\nreadBalance\nlistPeers");
			break;
		case 'mine':
			if (Plutus.transactions.length !== 0) {
				Plutus.mineTransactions(publicKey);
				sendMessage(produceMessage("TYPE_REPLACE_CHAIN", [
					Plutus.getLastBlock(),
					Plutus.difficulty
				]));
			} else {
				console.log('No transactions to mine');
			}
			break;
		case 'readBalance':
			console.log(Plutus.getBalance(publicKey));
			break;
		case 'listPeers':
			console.log(opened);
			break;
		case 'listPublic':
			console.log(keyPair.getPublic("hex"));
			break;
		case 'listPrivate':
			console.log(keyPair.getPrivate("hex"));
			break;
		case 'sendPlutus':
			const {amount} = await inquirer.prompt({
				type: 'number',
                name: 'amount',
                message: 'How much would you like to send?'
            });
            const {address} = await inquirer.prompt({
				type: 'input',
                name: 'address',
                message: 'Who would you like to send the Plutus to? (Must be a public address)'
            });
            const {gas} = await inquirer.prompt({
				type: 'number',
                name: 'gas',
                message: 'how much would you like to pay for gas? (gas is like a tip for the miners)'
            });
            const {confirm} = await inquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'Confirm transaction?',
                default: false
            });
            if(confirm){
                transaction = new Transaction(publicKey, address, amount, gas);
                transaction.sign(keyPair);
                sendMessage(produceMessage("TYPE_CREATE_TRANSACTION", transaction));
                Plutus.addTransaction(transaction);
            }
			break;
		case 'listBlockchain':
			console.log(Plutus);
			break;
		default:
	}
		console.log("\n")
	recurloop();
}
recurloop();
