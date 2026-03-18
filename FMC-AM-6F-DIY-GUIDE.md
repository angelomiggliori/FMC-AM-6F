# FMC-AM 6F — Guia DIY (Do It Yourself)
**Como Montar a sua Própria Controladora Física Focada na Nossa Plataforma**

Você não precisa ficar dependendo apenas de cliques na tela ou de adaptadores caros para ter este canivete suíço! Este guia fornece todas as bases práticas de como comprar, montar, plugar e criar a sua caixinha física usando os códigos que já desenvolvemos.

---

## 1. O Que Você Vai Precisar (Nível Hardware)

**Peças Físicas Bate-Pronto:**
*   **Microcontrolador Central:** `Raspberry Pi Pico/Pico W`. Custa menos de R$ 40 em sites locais e serve perfeitamente para simular o "mouse/teclado" via USB.
*   **Caixa do Equipamento:** Uma caixa formato Hammond para pedais (alumínio, ex: modelo `1590XX` ou similar comprida) para dar sustentação física aos botões.
*   **Botões de Pisão (Footswitches):** 6x Chaves momentâneas do tipo "SPST Momentary Footswitch Mute/Soft Click". Fáceis de achar e ideais para o sapato não "estalar".
*   **Diodos de Luz (Bônus):** Fita de corte LED WS2812B (NeoPixels). Eles farão o brilho reativo do BPM pulsante.
*   **Cabeamento e Adaptadores:** 1x Cabo USB-OTG na Zoom (para ler o pendrive), e um HUB USB conectando a Pico e a própria pedaleira direto ao PC/Smartphone com suporte OTG WebMIDI!

## 2. Conceito Vital de Funcionamento (Sem Mistérios)

Qual o "segredo" dessa placa falar com a pedaleira sem ter shield MIDI nativo?
Esta interface maravilhosa **RODA NA TELA (Navegador Chrome USB)**. Portanto, a placa **Pico atuará apenas como uma Emuladora de Teclado**.

**Diagrama de Funcionamento:**
```
  PICO (Teclado USB) ---> Pressiona TECLAS DE MACRO (ex: Num1) na Tela do Chrome
              |
              ✓
Navegador interpreta "Foi Clicado o FS1" 
              |
              ✓
Motor Engine traduz pra "Acionar Distortion via SysEx" 
              |
              ✓
Navegador manda via porta USB-OTG para a G1On!
```

## 3. Guia de Solda Simples

*   **Pino de Aterramento (GND):** Soldar um fio preto ligando todas as pernas direitas de cada uma de suas 6 chaves SPST entre si. Feito isso, engatar e soldar no pino "GND" do Pico.
*   **Pino de Sinal:** Soldar o pino esquerdo do 1º botão no `GP0` do Pico. O modelo do 2º botão vai no `GP1`, e assim por diante.
*   **Leds (Opcional):** Soldar o VCC/5V do NeoPixel no pino Power do Pico, e o cabo central DATA deles no pino `GP16`.

## 4. Colocando o "Cérebro" para Rodar

Uma vez que ligar sua Pi Pico via porta microUSB do seu Windows (Com o botão BOOTSEL pressionado antes de ligar para entrar como Pendrive):

**A) Baixando o MicroPython:**
* Despeje nela o arquivo MicroPython uf2 oficial (baixe do site da R-Pi Foundation).

**B) Script Tecladista (main.py):**
Com ajuda da IDE gratuíta *Thonny*, carregue seu Pico com a biblioteca básica de teclado para Python.
Nós temos o exportador autônomo!
*   Abra no nosso projeto o documento `fmc-editor.html`. 
*   Lá dentro, passe na tela `LEDS / PICO`. Tem um formato para a distribuição de fios que gera e copia automaticamente o script `main.py` com o Debounce correto. Salve dentro da Pico!

## 5. Como Ligar a Música Real!
No dia do show:
1. Ligue o Hub USB no seu PC/Mac/Chrome.
2. Ligue a R-Pi Pico num slot USB do HUB.
3. Ligue o cabo OTG da sua ZOOM no outro USB do HUB.
4. Abra a página `theme-headrush.html` local no seu navegador. Os seus pés no chão ditarão o que o mouse virtual fará na pedaleira!
5. Se quiser conectar o tap tempo do LED com a música... observe que nós deixamos o botão BPM piscante direto via envio WebSerial na base do código para versões avançadas.

Evoilá! Agora sua controladora DIY e super barata responde em Milissegundos como um sistema Integrado Nativo. Custa quase 10x menos do que importar sistemas complexos da fabricante oficial.
