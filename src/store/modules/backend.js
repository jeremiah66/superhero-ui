/* eslint no-param-reassign: ["error", { "ignorePropertyModificationsFor": ["state"] }] */
import Vue from 'vue';
import { times } from 'lodash-es';
// eslint-disable-next-line import/no-cycle
import Backend from '../../utils/backend';
import { createDeepLinkUrl } from '../../utils';

export default {
  namespaced: true,
  state: {
    tips: {},
    tipsPageCount: {},
    tipsReloading: {},
    tipsNextPageLoading: {},
    tipsEndReached: {},
    userComments: {},
    tip: {},
    comment: {},
    stats: null,
    prices: {},
  },
  getters: {
    minTipAmount: ({ prices: { usd } }) => 0.01 / usd,
  },
  mutations: {
    setTips({ tips, tipsReloading }, { args, value }) {
      Vue.set(tips, args, value);
      tipsReloading[args] = false;
    },
    addTips({
      tips, tipsPageCount, tipsEndReached, tipsNextPageLoading,
    }, { args, value }) {
      if (value.length) {
        tips[args].push(...value);
        tipsPageCount[args] += 1;
      } else Vue.set(tipsEndReached, args, true);
      tipsNextPageLoading[args] = false;
    },
    tipsReloading({ tipsReloading, tipsPageCount }, args) {
      Vue.set(tipsReloading, args, true);
      if (!tipsPageCount[args]) Vue.set(tipsPageCount, args, 1);
    },
    tipsNextPageLoading({ tipsNextPageLoading, tipsPageCount }, args) {
      Vue.set(tipsNextPageLoading, args, true);
      if (!tipsPageCount[args]) Vue.set(tipsPageCount, args, 1);
    },
    setUserComments({ userComments }, { address, value }) {
      Vue.set(userComments, address, value);
    },
    setTip({ tip }, { id, value }) {
      Vue.set(tip, id, value);
    },
    setComment({ comment }, { id, value }) {
      Vue.set(comment, id, value);
    },
    setStats(state, stats) {
      state.stats = stats;
    },
    setPrices(state, prices) {
      state.prices = prices;
    },
  },
  actions: {
    async reloadTips({ commit, state: { tipsPageCount, tipsReloading } }, args) {
      if (tipsReloading[args]) return;
      commit('tipsReloading', args);
      const value = (await Promise.all(
        times(tipsPageCount[args], (p) => Backend.getCacheFeed(p + 1, ...args)),
      )).flat().filter((p) => p);
      commit('setTips', { args, value });
    },
    async loadNextPageOfTips({ commit, state }, args) {
      if (state.tipsEndReached[args] || state.tipsNextPageLoading[args]) return;
      commit('tipsNextPageLoading', args);
      const value = await Backend.getCacheFeed(state.tipsPageCount[args] + 1, ...args);
      commit('addTips', { args, value });
    },
    async reloadUserComments({ commit }, address) {
      commit('setUserComments', {
        address,
        value: (await Backend.getUserComments(address))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      });
    },
    async reloadTip({ commit, rootState: { chainNames } }, id) {
      const [tip, comments] = await Promise.all([
        Backend.getCacheTipById(id),
        Backend.getTipComments(id),
      ]);
      commit('setTip', {
        id,
        value: {
          ...tip,
          comments: comments.map((comment) => ({
            ...comment,
            chainName: chainNames[comment.author],
          })),
        },
      });
    },
    async reloadComment({ commit }, id) {
      commit('setComment', { id, value: await Backend.getCommentById(id) });
    },
    async reloadStats({ commit, rootState: { sdk } }) {
      const [stats1, stats2, height] = await Promise.all([
        Backend.getCacheStats(),
        Backend.getStats(),
        sdk.height(),
      ]);
      commit('setStats', { ...stats1, ...stats2, height });
    },
    async reloadPrices({ commit }) {
      commit('setPrices', (await Backend.getPrice())?.aeternity);
    },
    // eslint-disable-next-line consistent-return
    async callWithAuth({ rootState: { useSdkWallet, sdk, address } }, { method, arg, to }) {
      const { challenge } = await Backend[method](address, arg);
      if (useSdkWallet) {
        const signature = await sdk.signMessage(challenge);
        const response = await Backend[method](address, { challenge, signature });
        return response;
      }

      const url = new URL(to || window.location, window.location);
      url.search = '';
      window.location = createDeepLinkUrl({
        type: 'sign-message',
        message: challenge,
        'x-success': `${url}?method=${method}&address=${address}&challenge=${challenge}&signature={signature}`,
      });
    },
    async sendComment(
      { dispatch, rootState: { address, useSdkWallet } },
      { tipId, text, parentId },
    ) {
      if (!useSdkWallet) {
        window.location = createDeepLinkUrl({
          type: 'comment', id: tipId, text, parentId,
        });
        return;
      }
      await dispatch('callWithAuth', {
        method: 'sendTipComment',
        arg: {
          tipId, text, author: address, parentId,
        },
      });
      await Promise.all([
        dispatch('reloadTip', tipId),
        ...parentId ? [dispatch('reloadComment', parentId)] : [],
        dispatch('reloadStats'),
      ]);
    },
  },
};
