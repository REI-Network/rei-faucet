import express from 'express';
import { DB, faucetobject } from './db';
import { config, web3 } from './model';

require('console-stamp')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l):label'
});

const db = new DB();
const app = express();
class Queuestring {
  requests: { req: any; res: any }[] = [];
  push(req: any, res: any): number {
    if (this.requests.length >= 100) {
      return -1;
    }
    return this.requests.push({ req, res });
  }
  pop() {
    return this.requests.shift();
  }
}

class Faucet {
  private initPromise!: Promise<void>;
  addressArray: string[] = [];
  faucetarray = new Array<faucetobject>();
  queueresolve: any = undefined;
  requestresolve: any = undefined;

  constructor() {
    this.initPromise = this.init();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.initaccounts(process.env['PRIVATEKEY']!.split(','));
  }

  async initaccounts(privatekeys: string[]) {
    for (const privatekey of privatekeys) {
      const a = web3.eth.accounts.wallet.add(web3.eth.accounts.privateKeyToAccount(privatekey));
      this.addressArray.push(a.address);
    }
    const accounts = web3.eth.accounts.wallet;
    await db.initTheAccounts(this.addressArray, this.faucetarray);
    console.log('finished init');
  }

  async findSuitableAccount() {
    await this.initPromise;
    this.faucetarray.sort((a, b) => {
      return a.gap - b.gap;
    });
    for (const a of this.faucetarray) {
      if (+a.balance < config.once_amount * 2) {
        console.log('Balance not enough:', a.address);
        continue;
      }
      if (a.gap < 11) {
        return this.faucetarray.indexOf(a);
      }
    }
    return -1;
  }

  async queueLoop() {
    await this.initPromise;
    console.log('start queue loop');
    while (1) {
      const index = await this.findSuitableAccount();
      if (index === -1) {
        await new Promise<void>((resolve) => {
          this.queueresolve = resolve;
        });
      }
      const reqandres = queue.pop();
      if (!reqandres) {
        await new Promise<void>((resolve) => {
          this.requestresolve = resolve;
        });
        continue;
      }
      const noncetosend = this.faucetarray[index].nonceTodo;
      this.faucetarray[index].nonceTodo++;
      this.faucetarray[index].balance = (+this.faucetarray[index].balance - config.once_amount - 1000000000 * 21000).toString();
      const req = reqandres.req;
      const res = reqandres.res;
      const ip = req.headers['x-real-ip'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
      //start to transfer transaction
      const fromaddress = this.faucetarray[index].address;
      const toaddress = req.query.address.toLocaleLowerCase();
      const recordinfo = await db.addRecordinfo(fromaddress, toaddress, ip, config.once_amount);
      console.log('Start to transfer to ', toaddress);
      try {
        let databaePromise: (value: void | PromiseLike<void>) => void;
        const trans = web3.eth.sendTransaction(
          {
            from: fromaddress,
            to: toaddress,
            value: config.once_amount,
            gasPrice: '1000000000',
            gas: '21000',
            nonce: noncetosend
          },
          async (_error, hash) => {
            console.log(hash);
            recordinfo.state = 1;
            recordinfo.nonce = noncetosend;
            recordinfo.transactionhash = hash;
            recordinfo.amount = config.once_amount;
            res.send({ ErrorCode: 0, message: 'Transaction transfered', transactionhash: hash });
            await recordinfo.save();
            const accountinfo = (await db.findAccount(fromaddress))!;
            accountinfo.nonceTodo++;
            accountinfo.save();
            databaePromise();
          }
        );
        await new Promise<void>((resolve) => {
          databaePromise = resolve;
        });
        await trans;
        console.log(trans);
      } catch (e) {
        console.error(e);
        this.faucetarray[index].nonceTodo--;
        this.faucetarray[index].balance = (+this.faucetarray[index].balance + config.once_amount + 1000000000 * 21000).toString();
        res.send({ ErrorCode: 4, message: 'Transfer failed' });
        recordinfo.state = -1;
        await recordinfo.save();
        return;
      }
    }
  }

  async receiptLoop() {
    await this.initPromise;
    console.log('start receipt loop');
    while (1) {
      const transArray = await db.findUnaffirmtranscation();
      if (transArray.length === 0) {
        continue;
      }
      transArray.sort((a, b) => {
        if (a.from === b.from) {
          return a.nonce - b.nonce;
        } else {
          return a.from > b.from ? 1 : -1;
        }
      });
      for (let index = 0; index !== -1 && index < transArray.length; ) {
        const instance = transArray[index];
        const faucetaccount = this.faucetarray.find((item) => item.address === instance.from)!;
        const receipt = await web3.eth.getTransactionReceipt(instance.transactionhash);
        if (receipt === null) {
          let databaePromise: (value: void | PromiseLike<void>) => void;
          index = transArray.findIndex((item) => item.from != instance.from);
          if (Date.now() - instance.createdAt > 300000) {
            const recordinfo = await db.addRecordinfo(instance.from, instance.from, '0', '0');
            const trans = web3.eth.sendTransaction(
              {
                from: instance.from,
                to: instance.from,
                value: 0,
                gasPrice: '1000000000',
                gas: '21000',
                nonce: instance.nonce
              },
              async (_error, hash) => {
                recordinfo.state = 1;
                recordinfo.nonce = instance.nonce;
                recordinfo.transactionhash = hash;
                recordinfo.amount = '0';
                await recordinfo.save();
                databaePromise();
              }
            );
            faucetaccount.balance = (+this.faucetarray[index].balance + config.once_amount - 1000000000 * 21000).toString();
            await new Promise<void>((resolve) => {
              databaePromise = resolve;
            });
            await instance.destroy();
            console.log('destroy');
          }
        } else {
          console.log('start to change state');
          instance.state = 2;
          faucetaccount.nonceNow = instance.nonce;
          faucetaccount.gap = faucetaccount.nonceTodo - faucetaccount.nonceNow;
          const accinstance = (await db.findAccount(faucetaccount.address))!;
          accinstance.nonceNow = faucetaccount.nonceNow;
          await instance.save();
          await accinstance.save();
          index++;
        }
      }
      let notbusy = 0;
      for (const a of this.faucetarray) {
        if (a.gap < 10) {
          notbusy = 1;
          break;
        }
      }
      if (notbusy && this.queueresolve) {
        this.queueresolve();
        this.queueresolve = undefined;
      }
    }
  }
}

const faucet = new Faucet();
const queue = new Queuestring();

const timeLimitCheck = async (req: any, res: any) => {
  if (!(await db.checkTimesLimit(req.query.address))) {
    res.send({ ErrorCode: 2, message: 'Only 3 times within 24 hours' });
    return;
  }
  if (queue.push(req, res) == -1) {
    res.send({ ErrorCode: 7, message: 'System busy' });
  }
  const address = req.query.address.toLocaleLowerCase();
  if (!web3.utils.isAddress(address)) {
    res.send({ ErrorCode: 3, message: 'Invalid address ,please check the format, example：/send?address=youraddress ' });
    return;
  }
  if (faucet.requestresolve) {
    faucet.requestresolve();
    faucet.requestresolve = undefined;
  }
};

app.use('/send', timeLimitCheck);

faucet.queueLoop();
faucet.receiptLoop();
app.listen(3000, function () {
  console.log('Server has been started');
});
