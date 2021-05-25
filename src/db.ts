import { Op } from 'sequelize';
import { AddressInfo, AccountInfo, sequelize, web3 } from './model';

export type fauetobject = { address: string; nonceTodo: number; gap: number; islocked: boolean };
export class DB {
  private initPromise!: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await sequelize.authenticate();
    await sequelize.sync();
  }

  async addPostinfo(address: string, ip: string) {
    await this.initPromise;
    const transaction = await sequelize.transaction();
    try {
      const postinfo = await AddressInfo.create(
        {
          address: address,
          ip: ip
        },
        { transaction }
      );
      await transaction.commit();
      return postinfo;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async checkTimesLimit(address: string): Promise<boolean> {
    await this.initPromise;
    const transaction = await sequelize.transaction();
    const addrRecords = await AddressInfo.findAll({
      order: [['id', 'DESC']],
      limit: 3,
      where: {
        [Op.and]: {
          address: address,
          state: { [Op.or]: [0, 1] }
        }
      },
      transaction
    });
    await transaction.commit();
    if (addrRecords.length < 3) {
      return true;
    }
    if (Date.now() - addrRecords[2].createdAt >= 1000 * 60 * 60 * 24) {
      return true;
    }
    return false;
  }

  async findSuitableAccount(fauetarray: fauetobject[]) {
    await this.initPromise;
    const transaction = await sequelize.transaction();
    try {
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async initTheAccounts(address: string[], fauctarray: fauetobject[]) {
    await this.initPromise;
    const transaction = await sequelize.transaction();
    try {
      const accountall = await AccountInfo.findAll();
      for (const addr of address) {
        const addrRecord = await AccountInfo.findOne({
          where: {
            address: addr
          },
          transaction
        });
        if (!addrRecord) {
          const nonce = await web3.eth.getTransactionCount(addr);
          await AccountInfo.create({
            address: address,
            nonceTodo: nonce
          });
          fauctarray.push({ address: addr, nonceTodo: nonce, gap: 0, islocked: false });
        } else {
          const nonce = await web3.eth.getTransactionCount(addr);
          if (nonce > addrRecord.nonceTodo) {
            addrRecord.nonceTodo = nonce;
          }
          fauctarray.push({ address: addr, nonceTodo: addrRecord.nonceTodo, gap: addrRecord.nonceTodo - nonce, islocked: false });
        }
      }
      transaction.commit();
    } catch (error) {
      transaction.rollback();
      throw error;
    }
  }

  async tansferWithNonce(from: string, to: string) {}
}
