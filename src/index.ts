import express from 'express';
import { DB, faucetobject } from './db';
import { config, web3 } from './model';

const app = express();
const privatekeys = process.env['PRIVATEKEY']!.split(',');
const address: string[] = [];
const faucetarray = new Array<faucetobject>();
const db = new DB();

const init = async () => {
  for (const privatekey of privatekeys) {
    const a = web3.eth.accounts.wallet.add(web3.eth.accounts.privateKeyToAccount(privatekey));
    address.push(a.address);
  }
  const accounts = web3.eth.accounts.wallet;
  console.log(await web3.eth.getTransactionCount(accounts[0].address));
  console.log(1);
  await db.initTheAccounts(address, faucetarray);
  console.log(2);
  console.log(faucetarray);
};

init();

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
    const faucetindex = await findSuitableAccount(faucetarray);
    if (faucetindex === -1) {
      res.send({ ErrorCode: 7, message: 'System busy' });
      return;
    }
    const faucetaddress = faucetarray[faucetindex].address;
    const balance = await web3.eth.getBalance(faucetaddress);
    if (+balance < config.once_amount * 2) {
      res.send({ ErrorCode: 6, message: 'Balance not enough' });
      return;
    }
    const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
    const postinfo = await db.addPostinfo(address, ip);

    const accountinfo = await db.findAccount(faucetaddress);
    if (accountinfo === null) {
      return;
    }
    console.log('Start to transfer to ', address);
    try {
      const trans = await web3.eth.sendTransaction({
        from: faucetaddress,
        to: address,
        value: config.once_amount,
        gasPrice: '1000000000',
        gas: '21000',
        nonce: faucetarray[faucetindex].nonceTodo
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
    accountinfo.nonceTodo++;
    postinfo.state = 1;
    faucetarray[faucetindex].nonceTodo++;
    await accountinfo.save();
    await postinfo.save();
  } catch (error) {
    console.log(error);
    res.send({ ErrorCode: 5, message: 'Unknown mistake' });
  }
});

async function findSuitableAccount(faucetarray: faucetobject[]) {
  for (const a of faucetarray) {
    const nonce = await web3.eth.getTransactionCount(a.address);
    a.gap = a.nonceTodo - nonce;
  }
  faucetarray.sort((a, b) => {
    return a.gap - b.gap;
  });
  for (const a of faucetarray) {
    if (a.islocked === false && a.gap < 10) {
      a.islocked = true;
      return faucetarray.indexOf(a);
    }
  }
  return -1;
}

app.listen(3000, function () {
  console.log('Server has been started');
});
