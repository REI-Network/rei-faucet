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
  max: 10,
  delayMs: 0,
  handler: (_req: any, res: any) => {
    res.format({
      html: function () {
        res.send({ ErrorCode: 1, message: 'The api call limit has been reached' });
      }
    });
  }
});

const timeLimitCheck = async (req: any, res: any, next: any) => {
  if (!(await db.checkTimesLimit(req.query.address))) {
    res.send({ ErrorCode: 2, message: 'Only 3 times within 24 hours' });
    return;
  }
  next();
};

app.use('/send', apiLimiter);
app.use('/send', timeLimitCheck);
app.get('/send', async (req: any, res: any) => {
  try {
    const address = req.query.address;
    if (!web3.utils.isAddress(address)) {
      res.send({ ErrorCode: 3, message: 'Invalid address ,please check the format, example：/send?address=youraddress ' });
      return;
    }
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
      res.send({ ErrorCode: 0, message: 'Successful', transactionhash: trans.transactionHash });
    } catch (e) {
      console.log(e);
      res.send({ ErrorCode: 4, message: 'Transfer failed' });
      return;
    }
    postinfo.state = 1;
    await postinfo.save();
  } catch (error) {
    console.log(error);
    res.send({ ErrorCode: 5, message: 'Unknown mistake' });
  }
});

app.get('/', (req: any, res: any) => {
  res.send('Start to get token for adding "/send?address=youraddress" ');
});
app.listen(3000, function () {
  console.log('app is listening at port 3000');
});
