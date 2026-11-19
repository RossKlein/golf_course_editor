import json
import os
import time
from course_maker.tests.test_design import BundleCase,rect,region
from course_maker.build.build import build_bundle
from course_maker.build.look import write_look
from course_maker.build.water import WATER_GRACE_SECONDS,generate_water,prune_water
from course_maker.models import Course,LakeSettings
from course_maker.compiler.validate import validate_bundle

class WaterBuildTests(BundleCase):
    def test_saved_preview_and_rebuild_have_identical_geometry(self):
        self.regions(region('lake',6,rect(20,20,80,70)))
        build_bundle(self.bundle)
        course=Course.read(self.bundle/'course.json')
        initial=course.waterMesh
        mesh=generate_water(self.bundle,course)
        lake=mesh['lakes'][0]
        course.look.water.lakes[lake['id']]=LakeSettings(anchor=lake['anchor'],level=42,offset=.2)
        preview=generate_water(self.bundle,course,course.look)
        write_look(self.bundle,course.look)
        saved=Course.read(self.bundle/'course.json')
        self.assertNotEqual(saved.waterMesh,initial)
        self.assertTrue((self.bundle/initial).exists())
        self.assertEqual(json.loads((self.bundle/saved.waterMesh).read_text()),preview)
        build_bundle(self.bundle)
        rebuilt=Course.read(self.bundle/'course.json')
        self.assertEqual(rebuilt.waterMesh,saved.waterMesh)
        self.assertEqual(validate_bundle(self.bundle).errors,[])

    def waters(self):
        return sorted(p.name for p in self.bundle.glob('water-*.json'))
    def age(self,name,seconds):
        t=time.time()-seconds
        os.utime(self.bundle/name,(t,t))
    def raise_water(self,offset):
        """Save the look with the first lake's surface this far above its estimate: a different mesh, so a new file."""
        course=Course.read(self.bundle/'course.json')
        lake=generate_water(self.bundle,course)['lakes'][0]
        course.look.water.lakes[lake['id']]=LakeSettings(anchor=lake['anchor'],offset=offset)
        write_look(self.bundle,course.look)
        return Course.read(self.bundle/'course.json').waterMesh
    def lake_bundle(self):
        self.regions(region('lake',6,rect(20,20,80,70)))
        build_bundle(self.bundle)
        current=Course.read(self.bundle/'course.json').waterMesh
        for name in self.waters():  # whatever the fixture started with is not this test's business
            if name!=current:
                (self.bundle/name).unlink()
        return current
    def test_old_meshes_are_deleted_but_the_current_and_recent_ones_stay(self):
        first=self.lake_bundle()
        second=self.raise_water(.1)
        self.assertNotEqual(first,second)
        self.assertEqual(self.waters(),sorted([first,second]))  # the first is recent: a reader of the old course.json may still want it
        self.age(first,WATER_GRACE_SECONDS+60)
        (self.bundle/'water-notes.json').write_text('{}')
        self.age('water-notes.json',WATER_GRACE_SECONDS+60)
        third=self.raise_water(.2)
        self.assertEqual(self.waters(),sorted(['water-notes.json',second,third]))  # the old one went, the recent one stayed, a file not named as a mesh is untouched
    def test_the_current_mesh_is_never_deleted_however_old(self):
        current=self.lake_bundle()
        course=Course.read(self.bundle/'course.json')
        self.age(current,10*WATER_GRACE_SECONDS)
        self.assertEqual(prune_water(self.bundle,course,grace=0),[])
        self.assertTrue((self.bundle/current).exists())
    def test_a_rebuild_prunes_too(self):
        self.lake_bundle()
        stale='water-0123456789abcdef.json'
        (self.bundle/stale).write_text('{}')
        self.age(stale,WATER_GRACE_SECONDS+60)
        build_bundle(self.bundle)
        self.assertNotIn(stale,self.waters())
        self.assertEqual(validate_bundle(self.bundle).errors,[])
