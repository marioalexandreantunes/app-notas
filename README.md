# Notas por Ditado

Este é um exemplo de aplicação que demonstra como utilizar um Modelo de Linguagem (LLM) para criar notas através de captura de audio numa aba do navegador e no microfone. O projeto inicial pode ser encontrado no [Google AI Studio](https://aistudio.google.com/).
# Como Executar e Implantar a Aplicação

Este repositório contém tudo o que necessita para executar a aplicação localmente.

## Requisitos

- Node.js

## Instruções para Execução Local

1. Instale as dependências:
   `npm install`
2. Defina a variável de ambiente `API_KEY` no ficheiro [.env.local](.env.local) com a sua chave API do Gemini.
3. Execute a aplicação:
   `npm run dev`

## Estrutura do Projeto

```
.
├── .gitignore
├── index.css
├── index.html
├── index.tsx
├── metadata.json
├── package-lock.json
├── package.json
├── README.md
├── START.cmd
├── START.sh
├── tsconfig.json
└── vite.config.ts
```

## Funcionalidades

- **Gravação de Áudio**: Permite ao usuário gravar notas de voz.
- **Transcrição de Áudio**: Utiliza um Modelo de Linguagem (LLM) para transcrever o áudio gravado em texto.
- **Edição de Notas**: Permite ao usuário visualizar e editar as notas transcritas.
- **Download de Notas**: Oferece a opção de baixar as notas em formato de texto.

## Tecnologias Utilizadas

Este projeto utiliza TypeScript para fornecer tipagem estática ao código JavaScript.
Utiliza as seguintes linguagens de programação e ferramentas:

- **TypeScript**: para a lógica do lado do cliente.
- **HTML**: para a estrutura do front-end.
- **CSS**: para o estilo do front-end.
- **Vite**: como ferramenta de build para um desenvolvimento rápido e eficiente.

## Sobre o Vite

O projeto utiliza o Vite como ferramenta de build para um desenvolvimento rápido e eficiente. O Vite oferece uma configuração otimizada e servidor de desenvolvimento com Hot Module Replacement (HMR), o que melhora a experiência de desenvolvimento.

Para iniciar o projeto com Vite, siga os passos abaixo:

1. Instale as dependências:
   `npm install`
2. Inicie o servidor de desenvolvimento:
   `npm run dev`
3. Construa o projeto para produção:
   `npm run build`

O Vite é ideal para projetos que exigem um desenvolvimento ágil e eficiente, proporcionando uma experiência fluida e rápida.
