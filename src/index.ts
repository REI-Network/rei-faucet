import express from 'express';
import HDWalletProvider from '@truffle/hdwallet-provider';
import fs from 'fs';
import Web3 from 'web3';
import { DB } from './db';
const RateLimit = require('express-rate-limit');

const app = express();
const infuraKey = fs.readFileSync('./projectconfig/net.infurakey').toString().trim();
const privatekey = fs.readFileSync('./projectconfig/net.privatekey').toString().trim();
const provider = new HDWalletProvider(privatekey, infuraKey);
const web3 = new Web3(provider);
const db = new DB();

const apiLimiter = new RateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  delayMs: 0,
  handler: (_req: any, res: any) => {
    res.format({
      json: function () {
        res.status(429).json(Error('Please request after 24 hours '));
      },
      html: function () {
        res.status(429).end('Please request after 24 hours');
      }
    });
  }
});

const timeLimitCheck = (req: any, res: any, next: any) => {
  if (!db.checkTimesLimit(req.query.address)) {
    res.status(429).end('Please request after 24 hours');
    return;
  }
  next();
};

app.use('/send', apiLimiter);
app.use('/send', timeLimitCheck);
app.get('/send', async (req: any, res: any) => {
  const address = req.query.address;
  const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
  const postinfo = await db.addPostinfo(address, ip);
  console.log('Start to transfer to ', address);
  const accounts = await web3.eth.getAccounts();
  try {
    const trans = await web3.eth.sendTransaction({
      from: accounts[0],
      to: address,
      value: '10000000000000000'
    });
    console.log(trans);
    res.send({ message: 'sucessful, the transaction hash is:', hash: trans.transactionHash });
  } catch (e) {
    console.log(e);
    res.status(500).send('failed, format error ,example：/send?address=youraddress');
  }
  postinfo.state = 1;
  await postinfo.save();
});

app.get('/', (req: any, res: any) => {
  res.send('Start to get token for adding "/send?address=youraddress" ');
});
app.listen(3000, function () {
  console.log('app is listening at port 3000');
});
