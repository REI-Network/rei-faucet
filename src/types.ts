import { BN } from 'ethereumjs-util';
import Web3 from 'web3';
import { DB } from './db';
import axios, { AxiosResponse } from 'axios';
import { AccountInfo, config, RecordInfo } from './model';

const web3 = new Web3(config.server_provider);

type reqandres = {
  req: { headers: { [headers: string]: string }; query: { address: string } };
  res: { send: (arg0: any) => void };
};
type axioObject = { method: string; params: string; resolve: (value: AxiosResponse<any>) => void };

export class faucetobject {
  address: string;
  nonceTodo: number;
  nonceNow: number;
  gap: number;
  balance: BN;
  db: DB;
  privateKey: string;
  accountinfo: AccountInfo;
  constructor(address: string, nonceTodo: number, nonceNow: number, gap: number, balance: BN, db: DB, accountinfo: AccountInfo, privateKey: string) {
    this.address = address;
    this.gap = gap;
    this.nonceNow = nonceNow;
    this.nonceTodo = nonceTodo;
    this.balance = balance;
    this.db = db;
    this.accountinfo = accountinfo;
    this.privateKey = privateKey;
  }
  async persist() {
    this.accountinfo.nonceNow = this.nonceNow;
    this.accountinfo.nonceTodo = this.nonceTodo;
    await this.db.saveInfos(this.accountinfo);
  }
}

export class Queuestring {
  queueresolve: undefined | ((value: reqandres) => void) = undefined;
  requests: reqandres[] = [];
  push(instance: reqandres) {
    if (this.queueresolve) {
      this.queueresolve(instance);
      this.queueresolve = undefined;
    } else {
      this.requests.push(instance);
    }
  }
  pop() {
    return this.requests.shift();
  }
}

class QueueObject {
  queueresolve: undefined | ((value: axioObject) => void) = undefined;
  requests: axioObject[] = [];
  push(instance: axioObject) {
    if (this.queueresolve) {
      this.queueresolve(instance);
      this.queueresolve = undefined;
    }
    this.requests.push(instance);
  }
  pop() {
    return this.requests.shift();
  }
}

export class Faucet {
  private initPromise!: Promise<void>;
  faucetarray: Array<faucetobject> = [];
  requestresolve: undefined | (() => void) = undefined;
  queue = new Queuestring();
  objectQueue = new QueueObject();
  db = new DB();
  timestamp = Math.floor(Date.now() / 1000);

  constructor() {
    this.initPromise = this.init();
    this.queueLoop();
    this.receiptLoop();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.initaccounts(process.env['PRIVATEKEY']!.split(','));
  }

  async initaccounts(privatekeys: string[]) {
    const accountArray: { address: string; privatekey: string }[] = [];
    for (const privatekey of privatekeys) {
      const address = web3.eth.accounts.privateKeyToAccount(privatekey).address;
      accountArray.push({ address, privatekey });
    }
    await this.db.initAccounts(accountArray, this.faucetarray, web3);
    console.log('finished init');
  }

  async getRawTransaction(from: string, to: string, count: string, nonce: number, gasPrice: string, privatekey: string) {
    const signedTransaction = await web3.eth.accounts.signTransaction(
      {
        from: from,
        to: to,
        value: config.once_amount,
        gasPrice: gasPrice,
        gas: '21000',
        nonce: nonce
      },
      privatekey
    );
    return signedTransaction.rawTransaction;
  }

  async findSuitableAccount() {
    await this.initPromise;
    this.faucetarray.sort((a, b) => {
      if (a.gap === b.gap) {
        return a.nonceNow - b.nonceTodo;
      }
      return a.gap - b.gap;
    });
    const min_amount = new BN(config.min_amount);
    for (const a of this.faucetarray) {
      if (a.balance.lt(min_amount)) {
        console.log('Balance not enough:', a.address);
        continue;
      }
      if (a.gap < 11) {
        return a;
      }
    }
    return undefined;
  }

  async queueLoop() {
    await this.initPromise;
    console.log('start queue loop');
    while (1) {
      let reqandres = this.queue.pop();
      if (!reqandres) {
        reqandres = await new Promise<reqandres>((resolve) => {
          this.queue.queueresolve = resolve;
        });
      }
      let suitableObj = await this.findSuitableAccount();
      if (suitableObj === undefined) {
        await new Promise<void>((resolve) => {
          this.requestresolve = resolve;
        });
        suitableObj = await this.findSuitableAccount();
      }
      let obj = suitableObj!;
      const noncetosend = obj.nonceTodo;
      obj.nonceTodo++;
      const balancenow = obj.balance;
      obj.balance = obj.balance.sub(new BN(config.once_amount).sub(new BN(1000000000 * 21000)));
      const { req, res } = reqandres;
      const ip = req.headers['x-real-ip'];
      //start to transfer transaction
      const fromaddress = obj.address;
      const toaddress = req.query.address.toLocaleLowerCase();
      const recordinfo = await this.db.addRecordinfo(fromaddress, toaddress, ip, config.once_amount);
      console.log('Start to transfer to', toaddress);
      try {
        const rawhash = await this.getRawTransaction(fromaddress, toaddress, config.once_amount, noncetosend, config.gas_price_usual, obj.privateKey);
        const result = await new Promise<AxiosResponse<any>>((resolve) => {
          this.objectQueue.push({ method: 'eth_sendRawTransaction', params: rawhash!, resolve: resolve });
        });
        const hash = result.data.result;
        recordinfo.state = 1;
        recordinfo.nonce = noncetosend;
        recordinfo.transactionhash = hash;
        recordinfo.amount = config.once_amount;
        await obj.persist();
        await this.db.saveInfos(recordinfo);
        res.send({ ErrorCode: 0, message: 'Transaction transfered', transactionhash: hash });
        console.log('transaction hash: ', hash);
      } catch (e) {
        obj.nonceTodo = noncetosend;
        obj.balance = balancenow;
        await obj.persist();
        recordinfo.state = -1;
        console.error(e);
        await this.db.saveInfos(recordinfo);
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
          const result = await new Promise<AxiosResponse<any>>((resolve) => {
            this.objectQueue.push({ method: 'eth_getTransactionReceipt', params: val.transactionhash, resolve: resolve });
          });
          const receipt = result.data.result;
          if (receipt === null) {
            if (Date.now() - val.createdAt > 300000) {
              const recordinfo = await this.db.addRecordinfo(val.from, val.from, '0', '0');
              const rawhash = await this.getRawTransaction(val.from, val.from, '0', val.nonce, config.gas_price_resend, faucetaccount.privateKey);
              const result = await new Promise<AxiosResponse<any>>((resolve) => {
                this.objectQueue.push({ method: 'eth_sendRawTransaction', params: rawhash!, resolve: resolve });
              });
              recordinfo.state = 1;
              recordinfo.nonce = val.nonce;
              recordinfo.transactionhash = result.data.result;
              recordinfo.amount = '0';
              val.state = -2;
              faucetaccount.balance = faucetaccount.balance.add(new BN(config.once_amoun));
              await this.db.saveInfos(recordinfo, val);
            }
            break;
          } else {
            val.state = 2;
            faucetaccount.nonceNow = val.nonce;
            faucetaccount.gap = faucetaccount.nonceTodo - faucetaccount.nonceNow;
            await faucetaccount.persist();
            await this.db.saveInfos(val);
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

  async timesLimitLoop() {
    await this.initPromise;
    let counter = 0;
    console.log('start timelimit loop');
    while (1) {
      counter++;
      const timenow = Math.floor(Date.now() / 1000);
      if (this.timestamp === timenow) {
        if (counter >= 10) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 1000);
          });
          counter = 0;
          this.timestamp = Math.floor(Date.now() / 1000);
        }
      } else {
        this.timestamp = timenow;
        counter = 0;
      }
      let instance = this.objectQueue.pop();
      if (!instance) {
        instance = await new Promise<axioObject>((resolve) => {
          this.objectQueue.queueresolve = resolve;
        });
      }
      try {
        const result = await axios({
          method: 'post',
          url: config.server_provider,
          data: {
            jsonrpc: '2.0',
            method: instance.method,
            params: [instance.params],
            id: 1
          }
        });
        instance.resolve(result);
      } catch (error) {
        console.log(error);
      }
    }
  }
}
