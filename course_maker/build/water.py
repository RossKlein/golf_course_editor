"""Authored water meshes. Each lake is cut out at its shore: the contour where the ground meets the water's surface, found on a fine grid
in the ground smoothed by a cubic B-spline (as the renderer smooths the relief), and limited to the painted outline grown by the lake's
`excess`. The mesh has many vertices along that edge and few inside, and runs a little past the exact shore: the renderer cuts the water at the
exact shore per pixel, from the heights, so it is right at every camera distance."""
from pathlib import Path
import hashlib
import json
import re
import time
import numpy as np
from scipy import ndimage
from scipy.spatial import Delaunay, cKDTree
from ..compiler.codec import read_png, decode_height, sample_bilinear
from ..models import Course, Look, LakeSettings
from ..project.store import atomic_write

# Engine settings for the shore, not the course's look.
SHORE_SMOOTHING = 3.0     # metres a cubic B-spline reaches either side when the ground is smoothed to find the shore in it
SHORE_STEP = 0.25         # metres between the grid points the shore is found on, so about between the vertices along it
SHORE_OVERLAP = 0.03      # metres of ground the mesh runs past the exact shore, at least, and (with the fall of the ground below the smooth one)
SHORE_OVERLAP_MAX = 0.15  # at most
OUTLINE_STAIRS = 0.3       # metres: the signed distance to the outline is blurred this much to take out the grid's stairs, which are a quarter of a metre; more also rounds the outline's tips (a metre of it let the water run a metre past them)
SHORE_LIFT_MAX = 0.10     # metres the water may be raised at the painted outline to meet a bank that stands above its level; a higher bank holds the water back
SHORE_LIFT_REACH = 1.0    # metres inside the outline over which that raise fades away: it is only for where the outline is the shore, and a bank further in is the ground's to decide
WATER_GRACE_SECONDS = 600  # an older mesh is kept this long after it stops being the current one: a reader that fetched the previous course.json may still be asking for it
INTERIOR_MIN_STEP = 4.0   # metres: the finest the lattice need be away from the shore. The surface is smooth, and the shader cuts the water at the exact shore from the heights, so a lake of 300 m does not need a vertex every 2 m in its middle; this keeps a small lake's mesh as coarse as a big one's (up to 40% of the file) for a level that is within 2 cm everywhere
POSITION_DECIMALS = (3, 4, 3)  # x, y, z: a millimetre across the lake and a tenth of one in height, which is far below anything the shader can show
NORMAL_DECIMALS = 4       # a normal is good to 0.006 degrees
SHORE_MAX_POINTS = 1_500_000  # the most grid points one lake's shore search uses: a bigger lake gets a coarser grid


def generate_water(folder, course: Course, look: Look | None = None):
    folder = Path(folder)
    classes = read_png(folder / course.class_.file)[0][..., 0]
    heights = decode_height(read_png(folder / course.height.file)[0], course.hMin, course.hMax)
    return water_mesh(classes, course.class_.res, heights, course.height.res, look or course.look)


def _bspline_smooth(values, scale):
    """`values` averaged with a cubic B-spline `scale` samples wide (the renderer's: it reaches 2 * scale samples either side)."""
    taps = int(np.ceil(2*scale))
    a = np.abs(np.arange(-taps,taps+1)/scale)
    w = np.where(a < 1,(4-6*a*a+3*a**3)/6,np.where(a < 2,(2-a)**3/6,0.0))
    w /= w.sum()
    return ndimage.convolve1d(ndimage.convolve1d(values,w,axis=0,mode='nearest'),w,axis=1,mode='nearest')


def _shore_cut(cells, res, origin, heights, height_res, surface, excess, outline_smoothing, inner_step):
    """
    The part of a lake's window that is water, as points (n, 2) of x, z, how far each is raised above `surface` (n,), and triangles (m, 3) of indices into them.

    `cells` is the lake's painted cells in the window (`res` metres each, the window's corner at `origin`), `surface(x, z)` its water surface.
    Water is where the surface is above the smoothed ground and within `excess` metres of the painted outline (drawn as the renderer does,
    the 0.5 contour of the cells blended by a B-spline over `outline_smoothing`), in the parts of that which touch the painted lake.
    The surface is raised where it meets the outline, by as much as the ground there stands above it (up to SHORE_LIFT_MAX), and the raise fades
    out SHORE_LIFT_REACH metres in. So a bank a few centimetres above the water, which no level setting hits exactly, does not hold the water
    back from the outline: the shore is the outline, as the ground shader draws it, and the water meets the bank there.
    """
    height, width = cells.shape
    size_x, size_z = width*res, height*res
    h = max(SHORE_STEP,float(np.sqrt(size_x*size_z/SHORE_MAX_POINTS)))
    gx = origin[0] + np.arange(int(np.ceil(size_x/h))+1)*h
    gz = origin[1] + np.arange(int(np.ceil(size_z/h))+1)*h
    xx,zz = np.meshgrid(gx,gz)

    # the ground, smoothed, and read off between its samples by a cubic spline
    scale = max(1.0,SHORE_SMOOTHING/(2*height_res))
    margin = int(np.ceil(2*scale))+3
    r0,r1 = max(0,int(gz[0]//height_res)-margin),min(heights.shape[0],int(gz[-1]//height_res)+margin+2)
    c0,c1 = max(0,int(gx[0]//height_res)-margin),min(heights.shape[1],int(gx[-1]//height_res)+margin+2)
    smooth = _bspline_smooth(np.asarray(heights[r0:r1,c0:c1],dtype=np.float64),scale)
    at_ground = [zz/height_res-r0,xx/height_res-c0]
    ground = ndimage.map_coordinates(smooth,at_ground,order=3,mode='nearest')
    drawn = ndimage.map_coordinates(np.asarray(heights[r0:r1,c0:c1],dtype=np.float64),at_ground,order=1,mode='nearest')  # the ground as the renderer draws it
    # The smooth ground is not the drawn ground: it is rounder, so the exact shore (where the drawn ground meets the water) is not quite where
    # the smooth one does. The mesh is a generous outline round the exact shore, which the renderer finds per pixel from the heights themselves
    # (so the shore is right at any distance from the camera, however coarse the ground mesh is drawn): it runs past the smooth shore by the most
    # the drawn ground falls below the smooth one within the spline's reach, smoothed (so the edge stays smooth) and by a margin.
    cells_reach = int(np.ceil(SHORE_SMOOTHING/h))
    fall = ndimage.maximum_filter(np.maximum(ground-drawn,0),size=2*cells_reach+1,mode='nearest')
    fall = np.minimum(_bspline_smooth(fall,cells_reach/2),SHORE_OVERLAP_MAX)  # capped: a cliff or a sculpted step must not spread the water metres
    # the painted outline, as drawn, and how far each point is inside (positive) or outside it
    blend = _bspline_smooth(cells.astype(np.float64),max(1.0,outline_smoothing/(2*res)))
    at = [(zz-origin[1])/res-.5,(xx-origin[0])/res-.5]
    inside = ndimage.map_coordinates(blend,at,order=1,mode='nearest') >= .5
    if not inside.any():  # a lake too small for the blend to hold: its own cells
        inside = ndimage.map_coordinates(cells.astype(np.float64),at,order=0,mode='nearest') > .5
    signed = np.where(inside,(ndimage.distance_transform_edt(inside)-.5)*h,-(ndimage.distance_transform_edt(~inside)-.5)*h)
    signed = ndimage.gaussian_filter(signed,OUTLINE_STAIRS/h)  # the grid's own stairs, which would otherwise be the edge where the outline is

    # the raise: how far the surface is below the ground at the outline (to the most allowed), fading out inside, and smoothed so the surface
    # does not step. The mesh already runs a little past the exact shore (`fall` and SHORE_OVERLAP), so meeting the ground is enough.
    level = surface(xx,zz)
    gap = drawn - level - SHORE_OVERLAP/2  # from the ground as drawn, which is what the renderer cuts the water by; the smooth one overshoots at a cliff
    need = np.where(gap <= SHORE_LIFT_MAX,np.maximum(gap,0),0.0)  # only a bank the raise can meet: a higher one holds the water back, and is not climbed a little
    lift = np.maximum(ndimage.gaussian_filter(need*np.clip(1 - signed/SHORE_LIFT_REACH,0,1),1.0/h),0)
    depth = level + lift - ground + fall + SHORE_OVERLAP
    field = np.minimum(depth,.3*(signed+excess))  # above 0 where there is water

    # only what touches the painted lake: not a hollow of its own beyond the excess
    labels,_ = ndimage.label(field > 0)
    keep = np.unique(labels[inside & (field > 0)])
    water = np.isin(labels,keep[keep > 0])
    if not water.any():
        return np.zeros((0,2)),np.zeros(0),np.zeros((0,3),dtype=int)
    field = np.where(water,field,np.minimum(field,-1e-6))

    # vertices on the shore: where `field` crosses 0 along each grid line
    edge = []
    for a,b,(xa,za),(xb,zb) in (
            (field[:,:-1],field[:,1:],(xx[:,:-1],zz[:,:-1]),(xx[:,1:],zz[:,1:])),
            (field[:-1],field[1:],(xx[:-1],zz[:-1]),(xx[1:],zz[1:]))):
        cross = (a > 0) != (b > 0)
        t = a[cross]/(a[cross]-b[cross])
        edge.append(np.column_stack((xa[cross]+t*(xb[cross]-xa[cross]),za[cross]+t*(zb[cross]-za[cross]))))
    edge = np.concatenate(edge)
    if len(edge):
        close = cKDTree(edge).query_pairs(.4*h,output_type='ndarray')  # one of each pair of near-duplicates (a crossing beside a grid point)
        keep = np.ones(len(edge),dtype=bool)
        keep[close[:,1]] = False
        edge = edge[keep]

    # vertices inside: every grid point right beside the shore, then fewer the further in, on a lattice that is coarser by powers of two
    away = ndimage.distance_transform_edt(water)*h
    levels = np.maximum(np.floor(np.log2(np.maximum(np.minimum(away,inner_step)/h,1))).astype(int),1)
    rows,cols = np.indices(water.shape)
    stride = 1 << levels
    inner = water & (away >= 1.5*h) & (rows % stride == 0) & (cols % stride == 0)
    points = np.concatenate((edge,np.column_stack((xx[inner],zz[inner]))))
    if len(points) < 3:
        return np.zeros((0,2)),np.zeros(0),np.zeros((0,3),dtype=int)

    # triangles: the points' Delaunay triangulation, less those that are not on water
    triangles = Delaunay(points).simplices
    centre = points[triangles].mean(axis=1)
    on = ndimage.map_coordinates(field,[(centre[:,1]-gz[0])/h,(centre[:,0]-gx[0])/h],order=1,mode='nearest') > 0
    p = points[triangles]
    cross = (p[:,1,0]-p[:,0,0])*(p[:,2,1]-p[:,0,1]) - (p[:,1,1]-p[:,0,1])*(p[:,2,0]-p[:,0,0])
    triangles = triangles[on & (np.abs(cross) > 1e-9)]
    cross = cross[on & (np.abs(cross) > 1e-9)]
    triangles[cross > 0] = triangles[cross > 0][:,[0,2,1]]  # one winding for all, the one the grid meshes had
    raise_by = ndimage.map_coordinates(lift,[(points[:,1]-gz[0])/h,(points[:,0]-gx[0])/h],order=1,mode='nearest')
    return points,raise_by,triangles


def water_mesh(classes, res, heights, height_res, look):
    labels, count = ndimage.label(classes == 6)
    lakes, overrides = [], {}
    for key, setting in look.water.lakes.items():
        x, z = setting.anchor
        c, r = int(np.floor(x/res)), int(np.floor(z/res))
        if 0 <= r < labels.shape[0] and 0 <= c < labels.shape[1] and labels[r,c]:
            label = int(labels[r,c])
            if label in overrides:
                raise ValueError('Two saved water controls belong to one merged lake. Remove one override.')
            overrides[label] = (key,setting)
    for n, box in enumerate(ndimage.find_objects(labels),1):
        if box is None:
            continue
        rz,cx = box
        excess = float(overrides[n][1].excess) if n in overrides else 0.0  # always a float, so the file's text (and so its hash) does not depend on how the setting was written
        # The window must hold the outline's smoothing and wobble, and the excess beyond it.
        pad = max(int(np.ceil((look.grass.smoothing + look.grass.wobble*res + look.grass.edgeRagged)/res)),int(np.ceil(excess/res)))+3
        z0,z1 = max(0,rz.start-pad),min(labels.shape[0],rz.stop+pad)
        x0,x1 = max(0,cx.start-pad),min(labels.shape[1],cx.stop+pad)
        mask = labels[z0:z1,x0:x1] == n
        rr,cc = np.nonzero(mask)
        distance = ndimage.distance_transform_edt(mask)
        ar,ac = np.unravel_index(np.argmax(distance),mask.shape)
        anchor = [(x0+ac+.5)*res,(z0+ar+.5)*res]
        key,settings = overrides.get(n,(f'lake-{x0+ac}-{z0+ar}',LakeSettings(anchor=anchor)))
        bank = ndimage.binary_dilation(mask) & (classes[z0:z1,x0:x1] != 6)
        br,bc = np.nonzero(bank)
        if not len(br):
            br,bc = rr,cc
        bx,bz = (bc+x0+.5)*res,(br+z0+.5)*res
        by = sample_bilinear(heights,height_res,bx,bz)
        estimated = float(np.median(by))+.03
        level = (estimated if settings.level is None else settings.level)+settings.offset
        # The surface: flat, or (with curvature) following the banks, worked out on a coarse grid and read off between its points.
        step = max(res,(x1-x0)*res/128,(z1-z0)*res/128)
        xs = np.linspace(x0*res,x1*res,max(2,int(np.ceil((x1-x0)*res/step))+1))
        zs = np.linspace(z0*res,z1*res,max(2,int(np.ceil((z1-z0)*res/step))+1))
        if settings.curvature:
            xx,zz = np.meshgrid(xs,zs)
            yy = np.full(xx.shape,level)
            # Broad shoreline fit, no hard constraints forcing the rim to meet the banks.
            stride = max(1,len(by)//2048)
            points = np.column_stack((bx[::stride],bz[::stride]))
            dist,ix = cKDTree(points).query(np.column_stack((xx.ravel(),zz.ravel())),k=min(32,len(points)))
            if dist.ndim == 1:
                dist,ix = dist[:,None],ix[:,None]
            weight = 1/(dist*dist+max(5,step*3)**2)
            curve = ((weight*by[::stride][ix]).sum(axis=1)/weight.sum(axis=1)).reshape(xx.shape)
            curve = ndimage.gaussian_filter(curve,2)
            yy += settings.curvature*(curve-float(np.median(by)))
            dz,dx = np.gradient(yy,zs,xs)
            slope = np.stack((-dx,np.ones_like(dx),-dz))
            slope /= np.linalg.norm(slope,axis=0,keepdims=True)
            def read(grid,x,z):
                return ndimage.map_coordinates(grid,[(z-zs[0])/(zs[1]-zs[0]),(x-xs[0])/(xs[1]-xs[0])],order=1,mode='nearest')
            surface = lambda x,z: read(yy,x,z)
        else:
            surface = lambda x,z: np.full(np.shape(x),level)
        points,raised,triangles = _shore_cut(mask,res,(x0*res,z0*res),heights,height_res,surface,excess,look.grass.smoothing,max(step,INTERIOR_MIN_STEP))
        if len(points):
            y = surface(points[:,0],points[:,1]) + raised  # raised a little where it meets a bank that stands above it (see _shore_cut)
            if settings.curvature:
                normals = np.column_stack([read(slope[i],points[:,0],points[:,1]) for i in range(3)])
                normals /= np.linalg.norm(normals,axis=1,keepdims=True)
            else:
                normals = np.tile([0.0,1.0,0.0],(len(points),1))
            positions = np.column_stack((points[:,0],y,points[:,1]))
        else:
            positions = normals = np.zeros((0,3))
        lakes.append(dict(id=key,anchor=list(settings.anchor),estimatedLevel=estimated,level=level,excess=excess,cut=True,
                          positions=np.column_stack([np.round(positions[:,i],d) for i,d in enumerate(POSITION_DECIMALS)]).reshape(-1).tolist(),
                          normals=np.round(normals.reshape(-1),NORMAL_DECIMALS).tolist(),indices=triangles.reshape(-1).tolist()))
    return dict(version=1,lakes=lakes)


def publish_water(folder,course):
    # Immutable filenames prevent a new mesh being paired with old metadata after an interrupted write.
    text = json.dumps(generate_water(folder,course),separators=(',',':'),allow_nan=False)
    name = 'water-'+hashlib.sha256(text.encode()).hexdigest()[:16]+'.json'
    atomic_write(Path(folder)/name,text+'\n')
    return course.model_copy(update={'waterMesh':name})


_WATER_NAME = re.compile(r'water-[0-9a-f]{16}\.json')


def prune_water(folder, course, grace=WATER_GRACE_SECONDS):
    """
    Delete the bundle's water meshes that are no longer in use. Every save or build publishes a new immutable `water-<hash>.json`, so without this
    they pile up (a mesh is about a megabyte). Call it after the new course.json is in place, while holding the bundle's lock. Kept: the one
    `course` names, and any other modified in the last `grace` seconds. Only files named exactly as publish_water names them are touched.
    Returns the names deleted.
    """
    folder = Path(folder)
    gone = []
    now = time.time()
    for path in folder.glob('water-*.json'):
        if path.name == course.waterMesh or not _WATER_NAME.fullmatch(path.name):
            continue
        try:
            if now - path.stat().st_mtime >= grace:
                path.unlink()
                gone.append(path.name)
        except OSError:
            pass  # in use (Windows) or already gone: the next save will take it
    return gone
