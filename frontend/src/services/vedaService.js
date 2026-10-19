import api from './api';

export const vedaService = {
  sendMessage: async (message, context = {}, history = []) => {
    const response = await api.post(
      '/veda/chat',
      {
        message,
        context,
        history,
      },
      {
        timeout: 60000,
      }
    );
    return response.data;
  },
};