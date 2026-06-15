import { defineConfig } from '@rspack/cli';
import { rspack, type SwcLoaderOptions } from '@rspack/core';
import { ReactRefreshRspackPlugin } from '@rspack/plugin-react-refresh';

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  entry: {
    main: './src/main.tsx',
  },
  target: ['browserslist:last 2 versions, > 0.2%, not dead, Firefox ESR'],
  output: {
    clean: true,
    publicPath: '/',
    // Hash de contenido en producción: cada build cambia el nombre del asset,
    // así el navegador nunca sirve un main.js cacheado y obsoleto (causa de
    // errores fantasma como React #185 tras un arreglo ya aplicado). En dev se
    // mantienen nombres estables para el HMR.
    filename: isDev ? '[name].js' : '[name].[contenthash].js',
    cssFilename: isDev ? '[name].css' : '[name].[contenthash].css',
  },
  resolve: {
    extensions: ['...', '.ts', '.tsx', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.svg$/,
        type: 'asset',
      },
      {
        test: /\.woff2?$/,
        type: 'asset/resource',
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: { '@tailwindcss/postcss': {} },
              },
            },
          },
        ],
        type: 'css/auto',
      },
      {
        test: /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/,
        use: [
          {
            loader: 'builtin:swc-loader',
            options: {
              detectSyntax: 'auto',
              jsc: {
                transform: {
                  react: {
                    runtime: 'automatic',
                    development: isDev,
                    refresh: isDev,
                  },
                },
              },
            } satisfies SwcLoaderOptions,
          },
        ],
      },
    ],
  },
  optimization: {
    // Solo separamos el runtime de React a su propio chunk (caché estable entre
    // builds). El resto del splitting se deja al comportamiento por defecto, que
    // mantiene las librerías usadas SOLO desde imports dinámicos (xyflow, xterm,
    // highlight, marked) en sus chunks async — fuera del bundle inicial.
    splitChunks: {
      cacheGroups: {
        reactVendor: {
          test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
          name: 'vendor-react',
          chunks: 'all',
          priority: 20,
        },
      },
    },
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: './index.html',
      // Copia favicon.svg a dist/ e inyecta <link rel="icon"> en index.html.
      favicon: './favicon.svg',
    }),
    isDev && new ReactRefreshRspackPlugin(),
  ],
  devServer: {
    port: 3000,
    historyApiFallback: true,
    // En desarrollo, API y WebSocket se delegan al backend de Go (:8089).
    proxy: [
      { context: ['/api'], target: 'http://127.0.0.1:8089' },
      { context: ['/ws'], target: 'ws://127.0.0.1:8089', ws: true },
    ],
  },
});
