/**
 * The time machine. The 2D canvas is uploaded every frame as a data plate (R = light, G = ember)
 * and pushed into a ring buffer of past frames. Each pixel samples the past according to its
 * distance from the pointer: near the pointer is the present, far away lags behind.
 * The plate stores ink density on white paper: the past lingers in warm grey, newly arrived
 * content appears as a pale cool grey and darkens as it develops.
 */
export const VERT = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv = p; gl_Position = vec4(p*2.-1., 0., 1.); }`;

export const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uNow;
uniform sampler2DArray uHist;
uniform float uHead, uN, uAmt, uLens, uStrobe, uFlash, uTime, uAspect;
uniform vec2 uMouse;
in vec2 vUv; out vec4 o;
vec2 tc;
float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
vec2 Hs(float d){
  d = clamp(d, 0., uN-1.);
  float f0 = floor(d), fr = d - f0;
  float l0 = mod(uHead - f0 + uN, uN), l1 = mod(uHead - f0 - 1. + uN, uN);
  return mix(texture(uHist, vec3(tc, l0)).rg, texture(uHist, vec3(tc, l1)).rg, fr);
}
void main(){
  tc = vec2(vUv.x, 1. - vUv.y);
  vec2 now = texture(uNow, tc).rg;
  vec2 h0 = Hs(0.);
  vec2 q = vec2(tc.x*uAspect, tc.y), m = vec2(uMouse.x*uAspect, uMouse.y);
  float field = smoothstep(uLens*.25, uLens*2.4, length(q - m));
  float d = uAmt*(uN-1.)*field;
  vec2 pa = Hs(d), pm = Hs(d*.5);
  float diff = max(max(abs(pa.r-h0.r), abs(pm.r-h0.r)), abs(pa.g-h0.g));
  float w = smoothstep(.015, .09, diff);
  float a = mix(now.r, pa.r, w);
  float b = mix(now.r, pm.r, w);
  float c = now.r;
  float acc = clamp(mix(now.g, pm.g, w), 0., 1.);
  float base = min(a, min(b, c));
  // ink on paper: the plate stores ink density. Settled ink is near-black; the past lingers as a
  // warm grey, content that has only just arrived is a pale cool grey that darkens as it "develops".
  vec3 paper = vec3(1.), ink = vec3(.035,.035,.04);
  vec3 col3 = paper - (paper - ink)*base
            - vec3(.40)*(a-base)
            - vec3(.18)*(b-base)
            - vec3(.16)*(c-base);
  col3 = mix(col3, ink, acc);
  if (uStrobe > .01) {
    float s = 0.;
    for (int k = 1; k < 8; k++) {
      float fk = float(k);
      vec2 v = Hs(fk*(uN-1.)/7.);
      s = max(s, v.r*(1.-fk/8.)*.45);
    }
    col3 = min(col3, vec3(1.) - vec3(.98,.98,.96)*s*uStrobe);
  }
  float g = h2(gl_FragCoord.xy + fract(uTime*7.31)*113.) - .5;
  col3 += g*.012;
  vec2 vv = tc - .5; col3 *= 1. - dot(vv, vv)*.05;
  col3 = mix(col3, vec3(1.) - col3, uFlash);
  o = vec4(clamp(col3, 0., 1.), 1.);
}`;
