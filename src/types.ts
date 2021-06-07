import { BN } from 'ethereumjs-util';
import Web3 from 'web3';
import { DB } from './db';
import axios from 'axios';
import { config, RecordInfo } from './model';

const web3 = new Web3(config.server_provider);

export type reqandres = {
  req: { headers: { [headers: string]: string }; query: { address: string } };
  res: { send: ({}) => void };
};

export class faucetobject {
  address: string;
  nonceTodo: number;
  nonceNow: number;
  gap: number;
  balance: BN;
  constructor(address: string, nonceTodo: number, nonceNow: number, gap: number, balance: BN) {
    this.address = address;
    this.gap = gap;
    this.nonceNow = nonceNow;
    this.nonceTodo = nonceTodo;
    this.balance = balance;
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
      return this.requests.push(instance);
    }
  }
  pop() {
    return this.requests.shift();
  }
}

export class Faucet {
  private initPromise!: Promise<void>;
  addressArray: string[] = [];
  faucetarray = new Array<faucetobject>();
  requestresolve: undefined | (() => void) = undefined;
  queue = new Queuestring();
  db = new DB();

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
    if (!process.env['PRIVATEKEY']) {
      process.exit(1);
    }
    await this.initaccounts(process.env['PRIVATEKEY'].split(','));
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

  async sendTransaction(from: string, to: string, count: string, nonce: number, privatekey: string) {
    const signedTransaction = await web3.eth.accounts.signTransaction(
      {
        from: from,
        to: to,
        value: config.once_amount,
        gasPrice: '1000000000',
        gas: '21000',
        nonce: nonce
      },
      privatekey
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
    return result;
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
          this.queue.queueresolve = resolve;
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
      console.log('Start to transfer to', toaddress);
      try {
        const result = await this.sendTransaction(fromaddress, toaddress, config.once_amount, noncetosend, privateKey);
        const hash = result.data.result;
        recordinfo.state = 1;
        recordinfo.nonce = noncetosend;
        recordinfo.transactionhash = hash;
        recordinfo.amount = config.once_amount;
        await this.db.updateNonce(fromaddress, obj.nonceTodo, 0);
        await this.db.saveRecordInfos(recordinfo);
        res.send({ ErrorCode: 0, message: 'Transaction transfered', transactionhash: hash });
        console.log('transaction hash: ', hash);
      } catch (e) {
        obj.nonceTodo = noncetosend;
        obj.balance = balancenow;
        recordinfo.state = -1;
        console.error(e);
        await this.db.saveRecordInfos(recordinfo);
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
              const walletindex = this.addressArray.indexOf(key);
              const privateKey = web3.eth.accounts.wallet[walletindex].privateKey;
              const recordinfo = await this.db.addRecordinfo(val.from, val.from, '0', '0');
              const result = await this.sendTransaction(val.from, val.from, '0', val.nonce, privateKey);
              recordinfo.state = 1;
              recordinfo.nonce = val.nonce;
              recordinfo.transactionhash = result.data.result;
              recordinfo.amount = '0';
              val.state = -2;
              faucetaccount.balance = faucetaccount.balance.add(new BN(config.once_amoun));
              await this.db.saveRecordInfos(recordinfo, val);
            }
            break;
          } else {
            //console.log('start to change state');
            val.state = 2;
            faucetaccount.nonceNow = val.nonce;
            faucetaccount.gap = faucetaccount.nonceTodo - faucetaccount.nonceNow;
            await this.db.updateNonce(faucetaccount.address, faucetaccount.nonceNow, 1);
            await this.db.saveRecordInfos(val);
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
