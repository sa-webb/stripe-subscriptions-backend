import { stripe } from './stripe';
import { IResolvers } from 'graphql-tools';
import * as bcrypt from 'bcrypt';

import { User } from './entity/User';

export const resolvers: IResolvers = {
  Query: {
    me: (_, __, { req }) => {
      if (!req.session.userId) {
        return null;
      }

      return User.findOne(req.session.userId);
    }
  },
  Mutation: {
    register: async (_, { email, password }) => {
      const hashedPassword = await bcrypt.hash(password, 10);
      await User.create({
        email,
        password: hashedPassword
      }).save();

      return true;
    },
    login: async (_, { email, password }, { req }) => {
      const user = await User.findOne({ where: { email } });
      if (!user) {
        return null;
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return null;
      }

      req.session.userId = user.id;

      return user;
    },
    createSubscription: async (_, { source, ccLast4 }, { req }) => {
      if (!req.session || !req.session.userId) {
        throw new Error('not authenticated');
      }

      const user = await User.findOne(req.session.userId);

      if (!user) {
        throw new Error();
      }

      let stripeId = user.stripeId;

      if (!stripeId) {
        const customer = await stripe.customers.create({
          email: user.email,
          source,
          plan: process.env.PLAN
        });
        stripeId = customer.id;
      } else {
        // update customer
        await stripe.customers.update(stripeId, {
          source
        });
        await stripe.subscriptions.create({
          customer: stripeId,
          plan: process.env.PLAN!
        })
      }

      user.stripeId = stripeId;
      user.type = 'test'; // plan nickname
      user.ccLast4 = ccLast4;

      await user.save();

      return user;
    },
    changeCreditCard: async (_, { source, ccLast4 }, { req }) => {
      if (!req.session || !req.session.userId) {
        throw new Error('not authenticated');
      }

      const user = await User.findOne(req.session.userId);

      if (!user || !user.stripeId || user.type !== 'test') {
        throw new Error();
      }
      await stripe.customers.update(user.stripeId, { source });

      user.ccLast4 = ccLast4;

      await user.save();

      return user;
    },
    cancelSubscription: async (_, __, { req }) => {
      if (!req.session || !req.session.userId) {
        throw new Error('not authenticated');
      }

      const user = await User.findOne(req.session.userId);

      if (!user || !user.stripeId || user.type !== 'test') {
        throw new Error();
      }

      const stripeCustomer = await stripe.customers.retrieve(user.stripeId);

      const [subscription] = stripeCustomer.subscriptions.data;

      await stripe.subscriptions.del(subscription.id);

      // Delete's card on file if customer cancels subscription
      stripe.customers.deleteSource(
        user.stripeId,
        stripeCustomer.default_source as string
      );

      // Sets new user type
      user.type = 'free-trial';
      // user.stripeId = null;
      await user.save();

      return user;
    }
  }
};
