# PROMPT MESTRE: CATALOGADOR ALIM E DECUPADOR (ELECTRON)

**Contexto e Objetivo:**
Você é um desenvolvedor especialista em Electron.JS e Node.js. Seu objetivo é desenvolver um aplicativo desktop nativo e 100% offline para catalogação linguística e preservação audiovisual (Projeto ALIM). O aplicativo integrará formulários baseados no Lameta, organização de arquivos por sessões, decupagem de mídia com processamento em fila e exportação para DSpace. Forneça todos os códigos completos, sem omitir partes.

**1. Arquitetura e Segurança (Electron):**
- Crie uma arquitetura multi-janelas gerenciada pelo Main Process: `mainWindow` (Catalogador principal) e `clipperWindow` (Pop-up de decupagem).
- Aplique `contextIsolation: true` e `nodeIntegration: false` em ambas as janelas.
- Crie um arquivo `preload.js` exposto via `contextBridge` para a comunicação IPC bidirecional.
- Implemente um protocolo customizado (ex: `media://`) via `protocol.handle` com suporte a headers de `Range` para permitir streaming e seek de vídeos locais no player HTML5.

**2. Gerenciamento de Workspace (Pasta de Trabalho):**
- A interface deve conter um botão "Abrir Pasta de Trabalho". Use `dialog.showOpenDialog({ properties: ['openDirectory'] })` para selecionar a raiz.
- **Explorador Lateral (Sidebar):** Use o módulo `fs` para ler a pasta e listar as sessões em uma barra lateral.
- **Estrutura Rigorosa:** 
  * `[Pasta Escolhida]/`
    * `sessao_01.json` (Arquivo interno de metadados da sessão)
    * `sessao_01_midias/` (Pasta exclusiva contendo as mídias da sessão 01)
- Ao anexar uma mídia externa na interface, o Node.js deve **copiar fisicamente** o arquivo para a subpasta da sessão correspondente. Os caminhos salvos no JSON devem ser sempre **relativos** (ex: `./sessao_01_midias/video.mp4`).

**3. Painel Principal (Catalogador e Formulário):**
- Crie um formulário focado no padrão Dublin Core: `dc.title`, `dc.contributor.advisor`, `dc.date.created`, `dc.identifier.other`, `dc.description.abstract` (multi-uso para Conteúdo, Participantes, etc.), `dc.description.sponsorship`, `dc.language`, `dc.language.iso`, `dc.publisher`, `dc.subject`, `dc.coverage.spatial` e `dc.type`.
- `dc.format.mimetype` deve ser preenchido automaticamente pela extensão do arquivo anexado.
- Campos com múltiplos valores (línguas, localizações) devem ter botões "+ Adicionar" dinâmicos.
- **Clonar Sessão:** Botão que copia os metadados preenchidos para iniciar uma nova sessão em branco rapidamente.

**4. Janela Secundária (Pop-up de Decupagem):**
- Abertura via clique na mídia anexada na `mainWindow`. Envia o caminho via IPC para o player.
- Player HTML5 no topo e inputs de tempo (IN e OUT) na base.
- Os tempos podem ser marcados por botões da timeline OU digitados manualmente pelo usuário.
- Atalhos de teclado: `Espaço` (Play/Pause), `I` (Marca In) e `O` (Marca Out).
- Botão "Adicionar à Fila de Corte": Envia os tempos para o Main Process via IPC, limpa as marcações, mas **não fecha a janela**, permitindo múltiplos cortes contínuos.

**5. Processamento de Mídia em Fila (FFmpeg):**
- Integre `fluent-ffmpeg` e `ffmpeg-static` (usar `asarUnpack: ["**/node_modules/ffmpeg-static/**"]` no package.json).
- Crie um serviço Node.js (`queueService.js`) que receba as ordens de corte e processe sequencialmente usando FFmpeg com `-c copy` (corte sem re-encode).
- **Interface da Fila:** A `mainWindow` deve ter um painel listando os recortes pendentes.
- **Controles:** O serviço de fila deve emitir o progresso (%) via IPC e ter funções para o usuário **Pausar** a fila inteira ou **Cancelar** um corte específico enviando um comando de interrupção ao FFmpeg.

**6. Exportação para DSpace (Simple Archive Format - SAF):**
- Botão na interface: "Exportar para DSpace (SAF)".
- O sistema deve gerar uma pasta de exportação contendo um subdiretório para cada sessão selecionada.
- Dentro de cada subdiretório, o Node.js deve:
  1. Gerar um arquivo `dublin_core.xml` no padrão exato do DSpace, convertendo os campos do formulário para nós `<dcvalue element="..." qualifier="...">`.
  2. Gerar o arquivo de texto `contents`, listando os nomes dos arquivos de mídia.
  3. Copiar os arquivos de mídia (originais e recortes) daquela sessão.
- Compactar a pasta final em um arquivo `.zip` pronto para upload no DSpace.

**Instruções de Entrega (Gere na seguinte ordem, aguardando confirmação):**
1. `package.json` (Dependências e scripts).
2. `main.js` (Janelas, IPC, protocolo e Workspace).
3. `preload.js` (Ponte de segurança).
4. `queueService.js` e `ffmpegService.js` (Fila, processamento, pause/cancel).
5. `dspaceExportService.js` (Geração do pacote SAF).
6. Frontend (`index.html`, `app.js`, `clipper.html`, `clipper.js` e CSS).