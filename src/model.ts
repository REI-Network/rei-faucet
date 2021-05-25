import { Sequelize, Model, DataTypes } from 'sequelize';
import process from 'process';
import Web3 from 'web3';

const configurl = process.env['CONFIG_URL'] || '../config.json';
export const config = require(configurl);
export const web3 = new Web3(config.server_provider);
export const sequelize = new Sequelize(config.database_url, { logging: false });

export class AddressInfo extends Model {}

export declare interface AddressInfo {
  address: string;
  ip: string;
  transactionhash: string;
  createdAt: number;
  state: number;
}

AddressInfo.init(
  {
    address: {
      type: DataTypes.STRING
    },
    ip: {
      type: DataTypes.STRING
    },
    transactionhash: {
      type: DataTypes.STRING
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
        fields: ['address', 'createdAt', 'state']
      }
    ]
  }
);

export class AccountInfo extends Model {}

export declare interface AccountInfo {
  address: string;
  nonceTodo: number;
}

AccountInfo.init(
  {
    address: { type: DataTypes.STRING },
    nonceTodo: { type: DataTypes.INTEGER }
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
