/**
 * Variant registry — every variant module exports a `descriptor` constant
 * conforming to VariantDescriptor<Type>. This file imports them and assembles
 * the full Registry map keyed by LoadingElementType.
 */

import type { Registry } from './types';

import { descriptor as ringDesc }            from './variants/RingVariant';
import { descriptor as dotPulseDesc }        from './variants/DotPulseVariant';
import { descriptor as cometTrailsDesc }     from './variants/CometTrailsVariant';
import { descriptor as hologramDesc }        from './variants/HologramVariant';
import { descriptor as particleStormDesc }   from './variants/ParticleStormVariant';
import { descriptor as wavyDensityDesc }     from './variants/WavyDensityVariant';
import { descriptor as doubleHelixDesc }     from './variants/DoubleHelixVariant';
import { descriptor as lissajousDesc }       from './variants/LissajousVariant';
import { descriptor as ripplingSpiralDesc }  from './variants/RipplingSpiralVariant';
import { descriptor as pulsingBandsDesc }    from './variants/PulsingBandsVariant';
import { descriptor as auroraBloomDesc }     from './variants/AuroraBloomVariant';
import { descriptor as rippleSphereDesc }    from './variants/RippleSphereVariant';
import { descriptor as fibonacciSphereDesc } from './variants/FibonacciSphereVariant';
import { descriptor as plasmaNoiseDesc }     from './variants/PlasmaNoiseVariant';
import { descriptor as orbitalShellsDesc }   from './variants/OrbitalShellsVariant';
import { descriptor as vortexDesc }          from './variants/VortexVariant';
import { descriptor as tvStaticDesc }        from './variants/TvStaticVariant';
import { descriptor as phyllotaxisDesc }     from './variants/PhyllotaxisVariant';
import { descriptor as icosahedronDesc }     from './variants/IcosahedronVariant';

export const REGISTRY: Registry = {
  ring: ringDesc,
  dotPulse: dotPulseDesc,
  cometTrails: cometTrailsDesc,
  hologram: hologramDesc,
  particleStorm: particleStormDesc,
  wavyDensity: wavyDensityDesc,
  doubleHelix: doubleHelixDesc,
  lissajous: lissajousDesc,
  ripplingSpiral: ripplingSpiralDesc,
  pulsingBands: pulsingBandsDesc,
  auroraBloom: auroraBloomDesc,
  rippleSphere: rippleSphereDesc,
  fibonacciSphere: fibonacciSphereDesc,
  plasmaNoise: plasmaNoiseDesc,
  orbitalShells: orbitalShellsDesc,
  vortex: vortexDesc,
  tvStatic: tvStaticDesc,
  phyllotaxis: phyllotaxisDesc,
  icosahedron: icosahedronDesc,
};
