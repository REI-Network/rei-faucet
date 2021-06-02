import express from 'express';
import { DB, faucetobject } from './db';
import { config, RecordInfo, web3 } from './model';
import { BN } from 'ethereumjs-util';

require('console-stamp')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l):label'
});

type reqandres = {
  req: { headers: { [headers: string]: string }; query: { address: string } };
  res: { send: ({}) => void };
};
const app = express();
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
    await this.db.initAccounts(this.addressArray, this.faucetarray);
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
      const ip = req.headers['x-real-ip'] || '1';
      //start to transfer transaction
      const fromaddress = obj.address;
      const toaddress = req.query.address.toLocaleLowerCase();
      const recordinfo = await this.db.addRecordinfo(fromaddress, toaddress, ip, config.once_amount);
      console.log('Start to transfer to ', toaddress);
      try {
        const hash = await new Promise<string>((resolve, reject) => {
          web3.eth.sendTransaction(
            {
              from: fromaddress,
              to: toaddress,
              value: config.once_amount,
              gasPrice: '1000000000',
              gas: '21000',
              nonce: noncetosend
            },
            (_error, hash) => {
              if (_error) {
                console.log('step 1');
                reject(_error);
                console.log('step 2');
              } else {
                console.log('step 3');
                console.log(hash);
                resolve(hash);
                console.log('step 4');
              }
            }
          );
        });
        recordinfo.state = 1;
        recordinfo.nonce = noncetosend;
        recordinfo.transactionhash = hash;
        recordinfo.amount = config.once_amount;
        console.log('step 5');
        const accountinfo = (await this.db.findAccount(fromaddress))!;
        accountinfo.nonceTodo++;
        console.log('step 6');
        await this.db.unifySave(recordinfo, accountinfo);
        res.send({ ErrorCode: 0, message: 'Transaction transfered', transactionhash: hash });
        console.log('transaction hash: ', hash);
        console.log('step 7');
      } catch (e) {
        console.log('step 8');
        obj.nonceTodo = noncetosend;
        obj.balance = balancenow;
        recordinfo.state = -1;
        console.error(e, 'step11');
        console.log('step 9');
        await recordinfo.save();
        res.send({ ErrorCode: 4, message: 'Transfer failed' });
        console.log('step 10');
      }
    }
  }

  async receiptLoop() {
    await this.initPromise;
    console.log('start receipt loop');
    while (1) {
      const transArray = await this.db.findUnaffirmtranscation();
      if (transArray.length === 0) {
        await (async () => {
          setTimeout(() => {}, 5000);
        })();
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
      transMap.forEach(async (values, key) => {
        for (const val of values) {
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
      });
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
    }
  }
}

const faucet = new Faucet();

const timeLimitCheck = async (req: any, res: any) => {
  if (!(await faucet.db.checkTimesLimit(req.query.address))) {
    res.send({ ErrorCode: 2, message: 'Only 3 times within 24 hours' });
    return;
  }
  if (faucet.queue.requests.length > 100) {
    res.send({ ErrorCode: 7, message: 'System busy' });
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
