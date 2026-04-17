/**
 * Derived scanner — runs AFTER all file-based scanners.
 *
 * Reads the aggregated {deps, scripts, signals} from the runtime registry
 * and computes project-wide identity signals: framework, test_framework, orm,
 * component library, build tool, state library, http client, css approach.
 *
 * Pure function — zero filesystem access. No parsing. Just mapping from
 * package names in `deps` to derived meaning.
 */

'use strict';

// Ordered: most specific frameworks first (Next.js beats React, Nuxt beats Vue)
const FRAMEWORK_MAP = [
  { pkg: 'next',            name: 'next',        label: 'Next.js' },
  { pkg: 'nuxt',            name: 'nuxt',        label: 'Nuxt' },
  { pkg: '@sveltejs/kit',   name: 'sveltekit',   label: 'SvelteKit' },
  { pkg: '@remix-run/react',name: 'remix',       label: 'Remix' },
  { pkg: 'astro',           name: 'astro',       label: 'Astro' },
  { pkg: 'solid-start',     name: 'solid-start', label: 'SolidStart' },
  { pkg: 'gatsby',          name: 'gatsby',      label: 'Gatsby' },
  { pkg: '@angular/core',   name: 'angular',     label: 'Angular' },
  { pkg: 'vue',             name: 'vue',         label: 'Vue' },
  { pkg: 'react',           name: 'react',       label: 'React' },
  { pkg: 'svelte',          name: 'svelte',      label: 'Svelte' },
  { pkg: 'solid-js',        name: 'solid',       label: 'Solid' },
  { pkg: 'express',         name: 'express',     label: 'Express' },
  { pkg: 'fastify',         name: 'fastify',     label: 'Fastify' },
  { pkg: 'hono',            name: 'hono',        label: 'Hono' },
  { pkg: 'nestjs',          name: 'nest',        label: 'NestJS' },
  { pkg: '@nestjs/core',    name: 'nest',        label: 'NestJS' },
  { pkg: 'django',          name: 'django',      label: 'Django',  ecosystem: 'pypi' },
  { pkg: 'fastapi',         name: 'fastapi',     label: 'FastAPI', ecosystem: 'pypi' },
  { pkg: 'flask',           name: 'flask',       label: 'Flask',   ecosystem: 'pypi' },
  { pkg: 'rails',           name: 'rails',       label: 'Rails',   ecosystem: 'rubygems' },
  { pkg: 'sinatra',         name: 'sinatra',     label: 'Sinatra', ecosystem: 'rubygems' },
  { pkg: 'laravel/framework',name:'laravel',     label: 'Laravel', ecosystem: 'composer' },
  { pkg: 'gin-gonic/gin',   name: 'gin',         label: 'Gin',     ecosystem: 'go' },
  { pkg: 'rocket',          name: 'rocket',      label: 'Rocket',  ecosystem: 'cargo' },
  { pkg: 'actix-web',       name: 'actix',       label: 'Actix',   ecosystem: 'cargo' },
  { pkg: 'axum',            name: 'axum',        label: 'Axum',    ecosystem: 'cargo' },
];

const TEST_MAP = [
  { pkg: 'vitest',   name: 'vitest' },
  { pkg: 'jest',     name: 'jest' },
  { pkg: 'mocha',    name: 'mocha' },
  { pkg: 'ava',      name: 'ava' },
  { pkg: 'playwright',name:'playwright' },
  { pkg: '@playwright/test', name: 'playwright' },
  { pkg: 'cypress',  name: 'cypress' },
  { pkg: 'pytest',   name: 'pytest',  ecosystem: 'pypi' },
  { pkg: 'rspec',    name: 'rspec',   ecosystem: 'rubygems' },
  { pkg: 'rspec-core',name:'rspec',   ecosystem: 'rubygems' },
  { pkg: 'phpunit/phpunit', name: 'phpunit', ecosystem: 'composer' },
];

const ORM_MAP = [
  { pkg: '@prisma/client', name: 'prisma' },
  { pkg: 'prisma',         name: 'prisma' },
  { pkg: 'drizzle-orm',    name: 'drizzle' },
  { pkg: 'typeorm',        name: 'typeorm' },
  { pkg: '@mikro-orm/core',name: 'mikroorm' },
  { pkg: 'sequelize',      name: 'sequelize' },
  { pkg: 'mongoose',       name: 'mongoose' },
  { pkg: 'knex',           name: 'knex' },
  { pkg: 'sqlalchemy',     name: 'sqlalchemy',  ecosystem: 'pypi' },
  { pkg: 'django',         name: 'django-orm',  ecosystem: 'pypi' },
  { pkg: 'diesel',         name: 'diesel',      ecosystem: 'cargo' },
  { pkg: 'sqlx',           name: 'sqlx',        ecosystem: 'cargo' },
  { pkg: 'gorm.io/gorm',   name: 'gorm',        ecosystem: 'go' },
];

const COMPONENT_LIB_MAP = [
  { pkg: '@mui/material',        name: 'mui' },
  { pkg: '@chakra-ui/react',     name: 'chakra' },
  { pkg: '@mantine/core',        name: 'mantine' },
  { pkg: '@radix-ui/react-dialog',name:'radix' },
  { pkg: 'antd',                 name: 'antd' },
];

const STATE_LIB_MAP = [
  { pkg: 'redux',   name: 'redux' },
  { pkg: '@reduxjs/toolkit', name: 'redux-toolkit' },
  { pkg: 'zustand', name: 'zustand' },
  { pkg: 'jotai',   name: 'jotai' },
  { pkg: 'pinia',   name: 'pinia' },
  { pkg: 'mobx',    name: 'mobx' },
  { pkg: '@tanstack/react-query', name: 'react-query' },
  { pkg: 'swr',     name: 'swr' },
];

const HTTP_MAP = [
  { pkg: 'axios',  name: 'axios' },
  { pkg: 'ky',     name: 'ky' },
  { pkg: 'got',    name: 'got' },
  { pkg: 'node-fetch', name: 'node-fetch' },
  { pkg: 'undici', name: 'undici' },
];

const CSS_MAP = [
  { pkg: 'tailwindcss',    name: 'tailwind' },
  { pkg: 'styled-components',name:'styled-components' },
  { pkg: '@emotion/react', name: 'emotion' },
  { pkg: 'sass',           name: 'sass' },
];

function lookup(deps, list) {
  for (const entry of list) {
    const eco = entry.ecosystem || 'npm';
    const hit = deps.find(d => d.ecosystem === eco && d.name === entry.pkg);
    if (hit) return { name: entry.name, label: entry.label || entry.name, version: hit.version };
  }
  return null;
}

function derive({ deps, scripts, signals }) {
  const out = {};

  const framework = lookup(deps, FRAMEWORK_MAP);
  if (framework) out.framework = framework;

  const testFw = lookup(deps, TEST_MAP);
  if (testFw) out.test_framework = testFw;

  const orm = lookup(deps, ORM_MAP);
  if (orm) out.orm = orm;

  const ui = lookup(deps, COMPONENT_LIB_MAP);
  if (ui) out.component_library = ui;

  const state = lookup(deps, STATE_LIB_MAP);
  if (state) out.state_library = state;

  const http = lookup(deps, HTTP_MAP);
  if (http) out.http_client = http;

  const css = lookup(deps, CSS_MAP);
  if (css) out.css_approach = css;

  // Package manager — prefer explicit `packageManager` field, else inferred from lockfile
  if (signals.package_manager) {
    out.package_manager = String(signals.package_manager).split('@')[0];
  } else if (signals.detected_pm) {
    out.package_manager = signals.detected_pm;
  }

  // Runtime — prefer explicit .nvmrc over engines range
  if (signals.node_version) {
    out.runtime = { language: 'node', version: signals.node_version };
  } else if (signals.python_version) {
    out.runtime = { language: 'python', version: signals.python_version };
  } else if (signals.ruby_version) {
    out.runtime = { language: 'ruby', version: signals.ruby_version };
  } else if (signals.rust_toolchain) {
    out.runtime = { language: 'rust', version: signals.rust_toolchain };
  } else if (signals.engines && signals.engines.node) {
    out.runtime = { language: 'node', version: String(signals.engines.node) };
  }

  return out;
}

module.exports = {
  derived: true,
  derive,
};
