import unittest
import numpy as np
from course_maker.build.water import SHORE_LIFT_MAX, water_mesh
from course_maker.models import LakeSettings
from course_maker.look_defaults import default_look

class WaterTests(unittest.TestCase):
    def setUp(self):
        self.classes=np.zeros((20,20),dtype=np.uint8)
        self.classes[4:16,4:16]=6
        self.heights=np.full((21,21),10.0)
        self.heights[5:16,5:16]=1
        self.look=default_look()
    def mesh(self):
        return water_mesh(self.classes,1,self.heights,1,self.look)
    def test_flat_and_independent_of_bed_depth(self):
        lake=self.mesh()['lakes'][0]
        y=np.array(lake['positions']).reshape(-1,3)[:,1]
        self.assertAlmostEqual(float(np.ptp(y)),0)
        self.assertGreater(y[0],9)
        self.heights[5:16,5:16]=-100
        deeper=self.mesh()['lakes'][0]
        self.assertEqual((deeper['level'],deeper['estimatedLevel']),(lake['level'],lake['estimatedLevel']))  # the banks set the level, not the bed
        self.assertAlmostEqual(float(np.ptp(np.array(deeper['positions']).reshape(-1,3)[:,1])),0)
    def test_controls_and_anchor_survive_outline_change(self):
        lake=self.mesh()['lakes'][0]
        self.look.water.lakes[lake['id']]=LakeSettings(anchor=lake['anchor'],level=7,offset=.5)
        self.classes[3,6:12]=6
        edited=self.mesh()['lakes'][0]
        self.assertEqual(edited['id'],lake['id'])
        y = np.array(edited['positions'])[1::3]
        self.assertTrue(np.all(y >= 7.5))
        self.assertTrue(np.all(y <= 7.5 + SHORE_LIFT_MAX))  # level plus offset, less than the little the shore is raised to meet a bank that stands above it
        self.assertEqual(float(np.median(y)), 7.5)
    def test_curvature_is_optional_and_normals_are_unit(self):
        self.heights+=np.arange(21)[None,:]*.3
        lake=self.mesh()['lakes'][0]
        self.look.water.lakes[lake['id']]=LakeSettings(anchor=lake['anchor'],curvature=.4)
        curved=self.mesh()['lakes'][0]
        self.assertGreater(np.ptp(np.array(curved['positions'])[1::3]),.1)
        np.testing.assert_allclose(np.linalg.norm(np.array(curved['normals']).reshape(-1,3),axis=1),1,atol=1e-3)  # written to 4 decimals
        self.assertLess(max(curved['indices']),len(curved['positions'])//3)
    def test_the_file_is_trimmed_to_what_can_be_seen(self):
        self.classes=np.zeros((80,80),dtype=np.uint8)
        self.classes[8:72,8:72]=6
        self.heights=np.full((81,81),10.0)
        self.heights[9:72,9:72]=1
        lake=self.mesh()['lakes'][0]
        p=np.array(lake['positions']).reshape(-1,3)
        for axis,decimals in ((0,3),(1,4),(2,3)):  # a millimetre across the lake, a tenth of one in height
            np.testing.assert_allclose(p[:,axis],np.round(p[:,axis],decimals),atol=1e-9)
        n=np.array(lake['normals'])
        np.testing.assert_allclose(n,np.round(n,4),atol=1e-9)
        # the middle of a big lake needs no fine lattice: past 10 m from the shore there is a vertex to every 3 m x 3 m at most
        middle=p[(p[:,0]>20)&(p[:,0]<60)&(p[:,2]>20)&(p[:,2]<60)]
        self.assertLessEqual(len(middle),(40*40)/9)
    def reach(self, lake):
        """The x, z of every corner of the carrier's triangles (so what ground it covers)."""
        p = np.array(lake['positions']).reshape(-1,3)
        ix = np.array(lake['indices']).reshape(-1,3)
        return p[ix][:,:,[0,2]].reshape(-1,2)
    def test_excess_grows_the_carrier_past_the_outline(self):
        plain = self.mesh()['lakes'][0]
        self.assertEqual(plain['excess'],0)
        self.look.water.lakes[plain['id']]=LakeSettings(anchor=plain['anchor'],level=12,excess=3)  # the water 2 m above the banks
        grown = self.mesh()['lakes'][0]
        self.assertEqual((grown['id'],grown['excess'],grown['level']),(plain['id'],3,12))
        glo,ghi = self.reach(grown).min(),self.reach(grown).max()
        self.assertLess(glo,4)  # the lake's cells start at 4 m
        self.assertGreaterEqual(4-glo,3)  # reaches at least the excess past the outline
        self.assertLessEqual(4-glo,3+2)  # and not much more: within a square or so
        self.assertGreaterEqual(ghi,16+3)
        self.assertLessEqual(ghi,16+3+2)
        self.assertGreater(len(grown['indices']),0)
    def test_excess_wider_than_the_default_window(self):
        self.classes[:]=0
        self.classes[8:12,8:12]=6
        self.heights[:]=1  # level ground, so the outline and the excess are all that limit the water
        lake = self.mesh()['lakes'][0]
        self.look.water.lakes[lake['id']]=LakeSettings(anchor=lake['anchor'],excess=7)
        xz = self.reach(self.mesh()['lakes'][0])
        self.assertGreaterEqual(8-xz.min(),6.5)
        self.assertLessEqual(8-xz.min(),7.5)
        self.assertGreaterEqual(xz.max()-12,6.5)
        self.assertLessEqual(xz.max()-12,7.5)
    def ramp(self, excess=5):
        """A lake with ground rising to the east, so the water stops where the ground reaches its level (2 m, at x = 14)."""
        self.heights[:]=(np.arange(21)[None,:]-10)*.5
        lake = self.mesh()['lakes'][0]
        self.look.water.lakes[lake['id']]=LakeSettings(anchor=lake['anchor'],level=2,excess=excess)
        return self.mesh()['lakes'][0]
    def test_the_shore_is_where_the_ground_meets_the_water(self):
        lake = self.ramp()
        xz = self.reach(lake)
        self.assertAlmostEqual(float(xz[:,0].max()),14,delta=.15)  # the outline is at 16, the ground meets the water at 14
        self.assertGreaterEqual(float(xz[:,0].max()),14)  # and the mesh runs to it or a little past it, never short: the renderer cuts the water exactly
        # and along that shore the vertices are close together
        shore = np.unique(xz[np.abs(xz[:,0]-14)<.2],axis=0)
        z = np.sort(shore[:,1])
        self.assertGreater(len(z),20)
        self.assertLess(float(np.diff(z).max()),.6)
    def test_the_outline_and_the_excess_limit_the_water_where_the_ground_is_lower(self):
        self.assertAlmostEqual(float(self.reach(self.ramp(excess=0))[:,0].min()),4,delta=.25)  # the painted outline, at the west
        self.assertAlmostEqual(float(self.reach(self.ramp(excess=2))[:,0].min()),2,delta=.25)
    def test_one_winding_and_every_triangle_has_area(self):
        lake = self.mesh()['lakes'][0]
        p = np.array(lake['positions']).reshape(-1,3)[:,[0,2]]
        t = np.array(lake['indices']).reshape(-1,3)
        a,b,c = p[t[:,0]],p[t[:,1]],p[t[:,2]]
        cross = (b[:,0]-a[:,0])*(c[:,1]-a[:,1])-(b[:,1]-a[:,1])*(c[:,0]-a[:,0])
        self.assertTrue(np.all(cross < 0))  # the winding the grid meshes had
        self.assertGreater(float(np.abs(cross).min()),1e-9)
    def test_separate_lakes_and_no_water(self):
        self.classes[:]=0
        self.assertEqual(self.mesh()['lakes'],[])
        self.classes[1:3,1:3]=6
        self.classes[16:18,16:18]=6
        self.assertEqual(len(self.mesh()['lakes']),2)
