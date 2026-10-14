# Stage 1: Build the React application
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ARG VITE_API_BASE_URL=http://localhost:5000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:1.25-alpine

# Set up a non-root user and group
RUN addgroup -S nginxgroup && adduser -S nginxuser -G nginxgroup

# Copy built assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx configuration
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Copy security headers configuration
RUN mkdir -p /etc/nginx/snippets
COPY deploy/nginx-security-headers.conf /etc/nginx/snippets/nginx-security-headers.conf

# Adjust permissions for non-root execution
RUN chown -R nginxuser:nginxgroup /var/cache/nginx && \
    chown -R nginxuser:nginxgroup /var/log/nginx && \
    chown -R nginxuser:nginxgroup /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginxuser:nginxgroup /var/run/nginx.pid && \
    chown -R nginxuser:nginxgroup /usr/share/nginx/html

# Switch to the non-root user
USER nginxuser

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
