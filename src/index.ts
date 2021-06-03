import express from 'express';
import { DB, faucetobject } from './db';
import { config, RecordInfo } from './model';
import { BN } from 'ethereumjs-util';
import axios from 'axios';
import Web3 from 'web3';
require('console-stamp')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l):label'
});

type reqandres = {
  req: { headers: { [headers: string]: string }; query: { address: string } };
  res: { send: ({}) => void };
};
const app = express();
const web3 = new Web3(config.server_provider);
class Queuestring {
  requests: reqandres[] = [];
  push(instance: reqandres): number {
    return this.requests.push(instance);
  }
  pop() {
    return this.requests.shift();
  }
}

class Faucet {
  private initPromise!: Promise<void>;
  addressArray: string[] = [];
  faucetarray = new Array<faucetobject>();
  requestresolve: undefined | (() => void) = undefined;
  queueresolve: undefined | ((value: reqandres) => void) = undefined;
  queue = new Queuestring();
  db = new DB();

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
    await this.db.initAccounts(this.addressArray, this.faucetarray, web3);
    console.log('finished init');
  }

  async findSuitableAccount() {
    await this.initPromise;
    this.faucetarray.sort((a, b) => {
      return a.gap - b.gap;
    });
    for (const a of this.faucetarray) {
      const mincount = new BN(config.min_amount);
      if (a.balance.lt(mincount)) {
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
      let reqandres = this.queue.pop();
      if (!reqandres) {
        reqandres = await new Promise<reqandres>((resolve) => {
          this.queueresolve = resolve;
        });
      }
      let index = await this.findSuitableAccount();
      if (index === -1) {
        await new Promise<void>((resolve) => {
          this.requestresolve = resolve;
        });
        index = await this.findSuitableAccount();
      }
      let obj = this.faucetarray[index];
      const noncetosend = obj.nonceTodo;
      obj.nonceTodo++;
      const balancenow = obj.balance;
      obj.balance = obj.balance.sub(new BN(config.once_amount).sub(new BN(1000000000 * 21000)));
      const { req, res } = reqandres;
      const ip = req.headers['x-real-ip'];
      //start to transfer transaction
      const fromaddress = obj.address;
      const walletindex = this.addressArray.indexOf(fromaddress);
      const privateKey = web3.eth.accounts.wallet[walletindex].privateKey;
      const toaddress = req.query.address.toLocaleLowerCase();
      const recordinfo = await this.db.addRecordinfo(fromaddress, toaddress, ip, config.once_amount);
      console.log('Start to transfer to ', toaddress);
      try {
        const signedTransaction = await web3.eth.accounts.signTransaction(
          {
            from: fromaddress,
            to: toaddress,
            value: config.once_amount,
            gasPrice: '1000000000',
            gas: '21000',
            nonce: noncetosend
          },
          privateKey
        );
        const result = await axios({
          method: 'post',
          url: config.server_provider,
          data: {
            jsonrpc: '2.0',
            method: 'eth_sendRawTransaction',
            params: [signedTransaction.rawTransaction],
            id: 1
          }
        });
        const hash = result.data.result;
        recordinfo.state = 1;
        recordinfo.nonce = noncetosend;
        recordinfo.transactionhash = hash;
        recordinfo.amount = config.once_amount;
        const accountinfo = (await this.db.findAccount(fromaddress))!;
        accountinfo.nonceTodo++;
        await this.db.unifySave(recordinfo, accountinfo);
        res.send({ ErrorCode: 0, message: 'Transaction transfered', transactionhash: hash });
        console.log('transaction hash: ', hash);
      } catch (e) {
        obj.nonceTodo = noncetosend;
        obj.balance = balancenow;
        recordinfo.state = -1;
        console.error(e);
        await recordinfo.save();
        res.send({ ErrorCode: 4, message: 'Transfer failed' });
      }
    }
  }

  async receiptLoop() {
    await this.initPromise;
    console.log('start receipt loop');
    while (1) {
      const transArray = await this.db.findUnaffirmtranscation();
      if (transArray.length === 0) {
        await new Promise<void>((resovle) => {
          setTimeout(resovle, 5000);
        });
        continue;
      }
      const transMap = new Map<string, RecordInfo[]>();
      transArray.sort((a, b) => {
        if (a.from === b.from) {
          return a.nonce - b.nonce;
        } else {
          return a.from > b.from ? 1 : -1;
        }
      });
      for (const tran of transArray) {
        const instance = transMap.get(tran.from);
        if (!instance) {
          transMap.set(tran.from, [tran]);
        } else {
          instance.push(tran);
        }
      }
      for (const key of transMap.keys()) {
        for (const val of transMap.get(key)!) {
          const faucetaccount = this.faucetarray.find((item) => item.address === val.from)!;
          const receipt = await web3.eth.getTransactionReceipt(val.transactionhash);
          if (receipt === null) {
            if (Date.now() - val.createdAt > 300000) {
              const recordinfo = await this.db.addRecordinfo(val.from, val.from, '0', '0');
              const hash = await new Promise<string>((res, rej) => {
                web3.eth.sendTransaction(
                  {
                    from: val.from,
                    to: val.from,
                    value: 0,
                    gasPrice: '1000000000',
                    gas: '21000',
                    nonce: val.nonce
                  },
                  async (_error, hash) => {
                    if (_error) {
                      rej(_error);
                    } else {
                      res(hash);
                    }
                  }
                );
              });
              recordinfo.state = 1;
              recordinfo.nonce = val.nonce;
              recordinfo.transactionhash = hash;
              recordinfo.amount = '0';
              val.state = -2;
              faucetaccount.balance = faucetaccount.balance.sub(new BN(1000000000 * 21000)).add(new BN(config.once_amoun));
              await this.db.unifySave(recordinfo, val);
            }
            break;
          } else {
            //console.log('start to change state');
            val.state = 2;
            faucetaccount.nonceNow = val.nonce;
            faucetaccount.gap = faucetaccount.nonceTodo - faucetaccount.nonceNow;
            const accinstance = (await this.db.findAccount(faucetaccount.address))!;
            accinstance.nonceNow = faucetaccount.nonceNow;
            await this.db.unifySave(val, accinstance);
          }
        }
      }
      let notbusy = 0;
      for (const a of this.faucetarray) {
        if (a.gap < 10) {
          notbusy = 1;
          break;
        }
      }
      if (notbusy && this.requestresolve) {
        this.requestresolve();
        this.requestresolve = undefined;
      }
      await new Promise<void>((resovle) => {
        setTimeout(resovle, 5000);
      });
    }
  }
}

const faucet = new Faucet();

const timeLimitCheck = async (req: any, res: any) => {
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
  if (faucet.queueresolve) {
    faucet.queueresolve({ req, res });
    faucet.queueresolve = undefined;
  } else {
    faucet.queue.push({ req, res });
  }
};

app.use('/send', timeLimitCheck);

faucet.queueLoop();
faucet.receiptLoop();
app.listen(3000, function () {
  console.log('Server has been started');
});
