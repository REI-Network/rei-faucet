import { Sequelize, Model, DataTypes } from 'sequelize';
import process from 'process';

const configurl = process.env['CONFIG_URL'] || '../config.json';
export const config = require(configurl);
export const sequelize = new Sequelize(config.database_url, { logging: false });

export class RecordInfo extends Model {}

export declare interface RecordInfo {
  from: string;
  to: string;
  ip: string;
  transactionhash: string;
  createdAt: number;
  state: number;
  amount: string;
  nonce: number;
}

RecordInfo.init(
  {
    from: {
      type: DataTypes.STRING
    },
    to: {
      type: DataTypes.STRING
    },
    ip: {
      type: DataTypes.STRING
    },
    transactionhash: {
      type: DataTypes.STRING
    },
    amount: {
      type: DataTypes.STRING
    },
    nonce: {
      type: DataTypes.INTEGER
    },
    state: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  },
  {
    sequelize,
    indexes: [
      {
        unique: true,
        fields: ['from', 'to', 'createdAt', 'transactionhash', 'state']
      }
    ]
  }
);

export class AccountInfo extends Model {}

export declare interface AccountInfo {
  address: string;
  nonceTodo: number;
  nonceNow: number;
}

AccountInfo.init(
  {
    address: {
      type: DataTypes.STRING
    },
    nonceTodo: {
      type: DataTypes.INTEGER
    },
    nonceNow: {
      type: DataTypes.INTEGER
    }
  },
  {
    sequelize,
    indexes: [
      {
        unique: true,
        fields: ['address']
      }
    ]
  }
);
