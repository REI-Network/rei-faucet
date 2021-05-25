import express from 'express';
import { DB, fauetobject } from './db';
import { config, web3 } from './model';

const app = express();
const privatekeys = process.env['PRIVATEKEY']!.split(',');
const address: string[] = [];
const fauetarray = new Array<fauetobject>();

const init = async () => {
  for (const privatekey of privatekeys) {
    const a = web3.eth.accounts.wallet.add(web3.eth.accounts.privateKeyToAccount(privatekey));
    address.push(a.address);
  }
  const accounts = web3.eth.accounts.wallet;
  console.log(await web3.eth.getTransactionCount(accounts[0].address));
  await db.initTheAccounts(address, fauetarray);
};
init();

const db = new DB();

const timeLimitCheck = async (req: any, res: any, next: any) => {
  if (!(await db.checkTimesLimit(req.query.address))) {
    res.send({ ErrorCode: 2, message: 'Only 3 times within 24 hours' });
    return;
  }
  next();
};

app.use('/send', timeLimitCheck);
app.get('/send', async (req: any, res: any) => {
  try {
    const address = req.query.address.toLocaleLowerCase();
    if (!web3.utils.isAddress(address)) {
      res.send({ ErrorCode: 3, message: 'Invalid address ,please check the format, example：/send?address=youraddress ' });
      return;
    }
    const fauetindex = await findSuitableAccount(fauetarray);
    // if (fauetaddress && gap && gap < 10) {
    // } else {
    //   res.send({ ErrorCode: 7, message: 'System busy' });
    //   return;
    // }
    const fauetaddress = fauetarray[fauetindex].address;
    const balance = await web3.eth.getBalance(fauetaddress);
    if (+balance < config.once_amount * 2) {
      res.send({ ErrorCode: 6, message: 'Balance not enough' });
      return;
    }
    const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
    const postinfo = await db.addPostinfo(address, ip);
    console.log('Start to transfer to ', address);

    try {
      const trans = await web3.eth.sendTransaction({
        from: fauetaddress,
        to: address,
        value: config.once_amount,
        gasPrice: '1000000000',
        gas: '21000'
      });
      console.log(trans);
      res.send({ ErrorCode: 0, message: 'Successful', transactionhash: trans.transactionHash });
    } catch (e) {
      console.log(e);
      res.send({ ErrorCode: 4, message: 'Transfer failed' });
      postinfo.state = -1;
      await postinfo.save();
      return;
    }

    postinfo.state = 1;
    await postinfo.save();
  } catch (error) {
    console.log(error);
    res.send({ ErrorCode: 5, message: 'Unknown mistake' });
  }
});

async function findSuitableAccount(fauetarray: fauetobject[]) {
  for (const a of fauetarray) {
    const nonce = await web3.eth.getTransactionCount(a.address);
    a.gap = a.nonceTodo - nonce;
  }
  fauetarray.sort((a, b) => {
    return a.gap - b.gap;
  });
  for (const a of fauetarray) {
    if (a.islocked === false && a.gap < 10) {
      return fauetarray.indexOf(a);
    }
  }
  return -1;
}

app.listen(3000, function () {
  console.log('Server has been started');
});
