/**
 * The time machine. The 2D canvas is uploaded every frame as a data plate (R = light, G = ember)
 * and pushed into a ring buffer of past frames. Each pixel samples the past according to its
 * distance from the pointer: near the pointer is the present, far away lags behind.
 * Old content that moved shows as ember, newly arrived content as ice.
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
float h1(float n){ return fract(sin(n*127.1+.7)*43758.5453); }
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
  float col = floor(tc.x*56.);
  float d = uAmt*(uN-1.)*clamp(field*(.6 + .4*h1(col)), 0., 1.);
  vec2 pa = Hs(d), pm = Hs(d*.5);
  float diff = max(max(abs(pa.r-h0.r), abs(pm.r-h0.r)), abs(pa.g-h0.g));
  float w = smoothstep(.015, .09, diff);
  float a = mix(now.r, pa.r, w);
  float b = mix(now.r, pm.r, w);
  float c = now.r;
  float acc = clamp(mix(now.g, pm.g, w), 0., 1.);
  float base = min(a, min(b, c));
  vec3 bone = vec3(.93,.915,.88), ember = vec3(1.,.31,.11), ice = vec3(.58,.82,1.);
  vec3 col3 = bone*base + ember*(a-base)*1.05 + bone*(b-base)*.5 + ice*(c-base)*.85;
  col3 = mix(col3, ember, acc);
  if (uStrobe > .01) {
    vec3 s = vec3(0.);
    for (int k = 1; k < 8; k++) {
      float fk = float(k);
      vec2 v = Hs(fk*(uN-1.)/7.);
      s = max(s, mix(bone, ember, fk/7.)*v.r*(1.-fk/8.)*.9);
    }
    col3 = max(col3, s*uStrobe);
  }
  float g = h2(gl_FragCoord.xy + fract(uTime*7.31)*113.) - .5;
  col3 += g*.05;
  vec2 vv = tc - .5; col3 *= 1. - dot(vv, vv)*.5;
  col3 = mix(col3, vec3(1.) - col3*vec3(.94,.97,1.), uFlash);
  o = vec4(max(col3, vec3(.014,.013,.012)), 1.);
}`;
