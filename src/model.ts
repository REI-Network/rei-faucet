import { Sequelize, Model, DataTypes } from 'sequelize';
import process from 'process';

export const sequelize = new Sequelize(process.env['DATABASE_URL']!, { logging: false });

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
