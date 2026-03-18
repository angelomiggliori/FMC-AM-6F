# FMC-AM 6F — Por Trás da Cortina (Visão Geral)
**Controladora MIDI Virtual para Zoom G1On**

Este documento explica de forma clara e acessível como a **FMC-AM 6F** funciona por baixo dos panos. É um "raio-x" do cérebro da nossa controladora, sem o peso excessivo de bytes e códigos densos.

---

## 1. O "Motor" da Controladora (Engine Modular)
Imagine o *FMC Engine* como o maestro de uma orquestra. Antigamente, ele era um arquivo gigante que fazia tudo ao mesmo tempo. Hoje, nós o dividimos em pequenos departamentos que trabalham juntos harmonicamente.

*   **O Setor de Comunicação (MIDI Core):** É o responsável por falar o idioma da Zoom. Ele manda os apertos de mão iniciais (Handshakes) e garante que a pedaleira não desista da conversa jogando "Pings" constantes para ela não dormir.
*   **O Gerente de Arquivos (Patch Manager):** Toda vez que você troca de timbre, ele escuta a informação bruta que vem da Zoom, traduz os nomes dos efeitos e joga na nossa tela de forma bonita e legível, separando-os em blocos visuais.
*   **O Atendente dos Botões (Footswitch):** Todo clique físico (ou toque na tela) passa por ele. Ele entende a diferença entre "dar um toquinho" para ligar/desligar um efeito e "segurar apertado" para abrir a janela de seleção de bancos.

## 2. A "Mágica" do Tap Tempo Sincronizado
A Zoom G1On de fábrica não tem um botão de *Tap Tempo* dedicado que sincroniza instantaneamente as repetições sem mudar de tela ou entrar em menus. Nós resolvemos isso matematicamente:

1.  **Ouvindo as Pisadas:** Ao invés de chutar a velocidade, a controladora ouve suas últimas pisadas e tira uma média de tempo entre elas. 
2.  **O Detetive Inteligente:** Ela olha para a tela e procura cegamente efeitos que sejam de "Atraso" (Delay) ou "Modulações" (Chorus). 
3.  **Conversão e Envio:** Depois de converter as pisadas em BPM (batidas por minuto), ela traduz os milissegundos num pacote e "injeta" cirurgicamente na pedaleira pelo cabo, sem que a Zoom precise trocar de tela ou piscar.

## 3. O Cofre Secreto da Zoom (Descobertas ZDL)
Um dos nossos maiores trunfos foi entrar no sistema fechado da Zoom. Os efeitos internos funcionam em uma arquitetura chamada `ZDL`. 
Sem depender de manuais ou vazamentos da internet, nossa engenharia automatizada descompactou quase 900 miniprogramas originais dentro da própria máquina e filtrou seus nomes, lendo a identidade visual de cada um.
Isso nos deu um **Catálogo Definitivo** dentro da controladora: ela sempre sabe qual efeito precisa receber o cálculo de Modulação e qual recebe o de Delay com precisão de 100%.

## 4. O Painel Flutuante (Double-Tap Editor)
Na nova versão 4.2+, implementamos a possibilidade de não apenas desligar e ligar efeitos, mas de interagir com o miolo deles.
Ao invés de carregar um enorme peso para descobrir qual número real está escrito no momento dentro do processador do efeito, nós desenvolvemos Sliders virtuais que operam fatiando em tempo-real.

*   **Como funciona?** Ao tocar duas vezes na imagem visual do Pedal na tela, abrimos uma janela escurecida com deslizantes que representam atributos (ex: `Feedback` ou `Time`).
*   **Controle Cirúrgico:** Assim que você arrasta a barrinha, disparamos a mensagem focada somente àquele atributo, injetando o novo valor direto no hardware, superando a barreira encriptada de 7-bits dos originais.

## Resumo da Sinfonia
Toda a operação se dá na internet fechada do seu próprio formato Web MIDI. Se o usuário abre a página (que também roda local e de graça no computador), o navegador toma conta, amarra os botões desenhados (e os físicos construíveis) com este Motor modular que foi milimetricamente desenhado pra ignorar "falhas de leitura" antigas e controlar seu setup via cabo USB!
