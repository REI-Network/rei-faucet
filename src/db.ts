import { Op } from 'sequelize';
import { AddressInfo, sequelize } from './model';

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
          ip: ip,
          createtime: Date.now()
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
      limit: 10,
      where: {
        [Op.and]: {
          address: address,
          state: 1
        }
      },
      transaction
    });
    if (!addrRecords || addrRecords.length < 3) {
      return true;
    }
    if (addrRecords[0].createtime - addrRecords[2].createtime <= 1000 * 60 * 60 * 24) {
      return true;
    }
    return false;
  }
}
