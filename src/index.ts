import express from 'express';
import { config } from './model';
import Web3 from 'web3';
import { Faucet } from './types';
import { logger } from './logger';
require('console-stamp')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l):label'
});

if (!process.env['PRIVATEKEY']) {
  process.exit(1);
}
const app = express();
const web3 = new Web3(config.server_provider);
const faucet = new Faucet();
let counted = 0;
const port = Number(process.env.PORT) || 20001;
const localhost = process.env.LOCALHOST || '127.0.0.1';
const timeLimitCheck = async (req: any, res: any) => {
  try {
    console.log('========== the ', ++counted, ' request===========');
    console.log('========== there are ', faucet.queue.requests.length, ' in the queue');
    if (faucet.queue.requests.length > config.request_queue_length) {
      res.send({ ErrorCode: 5, message: 'System busy' });
      console.log('System busy', faucet.queue.requests.length, ' in the queue');
      return;
    }
    const address = req.query.address.toLocaleLowerCase();
    if (!web3.utils.isAddress(address)) {
      res.send({ ErrorCode: 3, message: 'Invalid address ,please check the format, example：/send?address=youraddress ' });
      return;
    }
    faucet.queue.push({ req, res });
  } catch (error) {
    console.log(error);
    res.send({ ErrorCode: 6, message: 'Format error' });
  }
};
app.all('*', function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'X-Requested-With');
  res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,OPTIONS');
  res.header('X-Powered-By', ' 3.2.1');
  res.header('Content-Type', 'application/json;charset=utf-8');
  next();
});

app.use('/send', timeLimitCheck);
app.listen(port, localhost, function () {
  console.log('Server has been started');
});
