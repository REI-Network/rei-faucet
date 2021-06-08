import express from 'express';
import { config } from './model';
import Web3 from 'web3';
import { Faucet } from './types';
require('console-stamp')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l):label'
});

if (!process.env['PRIVATEKEY']) {
  process.exit(1);
}
const app = express();
const web3 = new Web3(config.server_provider);
const faucet = new Faucet();

const port = Number(process.env.PORT) || 20001;
const localhost = process.env.LOCALHOST || '127.0.0.1';
const timeLimitCheck = async (req: any, res: any) => {
  try {
    if (!(await faucet.db.checkAddressLimit(req.query.address))) {
      res.send({ ErrorCode: 1, message: 'A address only 3 times within 24 hours' });
      return;
    }
    if (!(await faucet.db.checkIpLimit(req.headers['x-real-ip']))) {
      res.send({ ErrorCode: 2, message: 'A Ip only 10 times within 24 hours' });
      return;
    }
    if (faucet.queue.requests.length > 100) {
      res.send({ ErrorCode: 5, message: 'System busy' });
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

app.use('/send', timeLimitCheck);
app.listen(port, localhost, function () {
  console.log('Server has been started');
});
